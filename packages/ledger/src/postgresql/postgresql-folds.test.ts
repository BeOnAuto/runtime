import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { topicRows } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';

function described(sql: SQL): string {
  return SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').trim();
}

interface Recorded {
  readonly execute: StatementExecutor;
  readonly queries: string[];
  readonly commands: string[];
}

function recordedAnswering(answers: (statement: string) => readonly unknown[]): Recorded {
  const queries: string[] = [];
  const commands: string[] = [];
  return {
    queries,
    commands,
    execute: {
      query: (sql) => {
        queries.push(described(sql));
        return Promise.resolve({ rows: answers(described(sql)) });
      },
      command: (sql) => {
        commands.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}

const keyed = postgresqlProjectionsOf({ projections: [topicRows] });

const storedTopic = { topic: 'spring', note: null, last_message: 'm1', open: false, next_at: null, due_at: null };

function topicAnswering(statement: string): readonly unknown[] {
  return statement.startsWith('SELECT topic') ? [storedTopic] : [];
}

function appendedNote(type: string, data: unknown) {
  return {
    type,
    data: { json: JSON.stringify(data) },
    metadata: {
      streamName: 'playbook/acme/alpha/notes/n1',
      messageId: 'm2',
      streamPosition: 2n,
      at: '2026-10-05T09:00:00.000Z',
      by: 'topics',
    },
  };
}

describe('the fold of a projection keyed by its mapping on PostgreSQL', () => {
  it('leaves the columns its reader advances as they stand unless the fact sets them', async () => {
    const fold = recordedAnswering(topicAnswering);
    const [registration] = keyed.registrations;

    await registration?.projection.handle(
      [
        appendedNote('topic_noted', { topic: 'spring', note: 'later' }),
        appendedNote('topic_opened', { topic: 'spring', at: 1000 }),
      ],
      { execute: fold.execute },
    );

    expect(fold.commands.map((command) => command.slice(command.indexOf('DO UPDATE SET')))).toEqual([
      'DO UPDATE SET topic = excluded.topic, note = excluded.note, last_message = excluded.last_message',
      'DO UPDATE SET topic = excluded.topic, note = excluded.note, last_message = excluded.last_message, open = excluded.open, next_at = excluded.next_at, due_at = excluded.due_at',
    ]);
  });
});

describe('the locks of a fold of a projection on PostgreSQL', () => {
  it('lock each row it folds, once and in the order of their keys, before it reads one', async () => {
    const fold = recordedAnswering(topicAnswering);
    const [registration] = keyed.registrations;

    await registration?.projection.handle(
      [
        appendedNote('topic_noted', { topic: 'spring', note: 'later' }),
        appendedNote('topic_noted', { topic: 'autumn', note: 'later' }),
        appendedNote('topic_opened', { topic: 'spring', at: 1000 }),
      ],
      { execute: fold.execute },
    );

    expect(fold.queries.slice(0, 5)).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended("topics_2:playbook/acme/alpha/autumn", 0))',
      'SELECT 1 FROM topics_2 WHERE playbook_key = "playbook/acme/alpha/" AND row_key = "autumn" FOR UPDATE',
      'SELECT pg_advisory_xact_lock(hashtextextended("topics_2:playbook/acme/alpha/spring", 0))',
      'SELECT 1 FROM topics_2 WHERE playbook_key = "playbook/acme/alpha/" AND row_key = "spring" FOR UPDATE',
      expect.stringMatching(/^SELECT topic, note/u),
    ]);
  });

  it('writes, of the columns its reader advances, each one the fact sets and none other', async () => {
    const fold = recordedAnswering(topicAnswering);
    const noteOpens = {
      ...topicRows,
      advanced: [
        { column: 'open', setBy: ['topic_opened', 'topic_noted'] },
        { column: 'next_at', setBy: ['topic_opened'] },
        { column: 'due_at', setBy: ['topic_opened'] },
      ],
    };
    const [registration] = postgresqlProjectionsOf({ projections: [noteOpens] }).registrations;

    await registration?.projection.handle([appendedNote('topic_noted', { topic: 'spring', note: 'later' })], {
      execute: fold.execute,
    });

    expect(fold.commands.map((command) => command.slice(command.indexOf('DO UPDATE SET')))).toEqual([
      'DO UPDATE SET topic = excluded.topic, note = excluded.note, last_message = excluded.last_message, open = excluded.open',
    ]);
  });
});
