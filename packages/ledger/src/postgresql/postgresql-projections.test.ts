import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { runTallyRows, topicRows } from '@on.auto/operations/testing';
import { Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { formattedFor, type Query } from '../postgresql-reads/recorded-parts.ts';
import { postgresqlCatchUp } from '../projection-catch-up/postgresql-catch-up.ts';
import { postgresqlProjectionDialect, postgresqlProjectionsOf } from './postgresql-projections.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(rows: readonly unknown[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text: text.replaceAll(/\s+/gu, ' ').trim(), values });
      return Promise.resolve(rows);
    },
  };
}

const stored = {
  playbook_key: 'playbook/acme/alpha/',
  row_key: 'r1',
  fn: 'triage',
  began_at: 1000,
  status: 'started',
  facts: 1,
  open: true,
  due_at: 61_000,
  last_message: 'm1',
};

const alpha = { org: 'acme', playbook: 'alpha' };

function readerOf(query: Query) {
  return postgresqlProjectionsOf({ projections: [runTallyRows, topicRows] }).readerOn({
    query: formattedFor(query),
    command: formattedFor(query),
    inTransaction: (work) =>
      work({ query: () => Promise.resolve({ rows: [] }), command: () => Promise.resolve({ rows: [] }) }),
  });
}

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
        return Promise.resolve({ rows: answers(described(sql)) });
      },
    },
  };
}

const keyed = postgresqlProjectionsOf({ projections: [topicRows] });

function noted(point: number, topic: string) {
  return {
    point: `7/${point}`,
    ordered: `${'7'.padStart(20, '0')}/${String(point).padStart(20, '0')}`,
    stream: `playbook/acme/alpha/notes/n${point}`,
    type: 'topic_opened',
    data: { json: JSON.stringify({ topic, at: point }) },
    metadata: { at: '2026-10-05T09:00:00.000Z', by: 'topics' },
    position: 1,
  };
}

const appendedCount = 258;

function topicOf(index: number): string {
  return index < 256 ? `t${index % 2}` : 't2';
}

const appended = Array.from({ length: appendedCount }, (_, index) => ({
  ...noted(index + 1, topicOf(index)),
  ...(index === appendedCount - 1 ? { stream: 'x' } : {}),
}));

const listed = Array.from({ length: appendedCount }, (_, index) => ({
  point: `7/${index + 1}`,
  stream: appended[index]?.stream,
  type: 'topic_opened',
  size: JSON.stringify({ topic: topicOf(index), at: index + 1 }).length,
}));

function positionAfter(statement: string, comparison: string): number | undefined {
  const found = new RegExp(`${comparison} \\(split_part\\("\\d+/(\\d+)"`, 'u').exec(statement);
  return found === null ? undefined : Number(found[1]);
}

function limitOf(statement: string): number {
  return Number(/LIMIT (\d+)/u.exec(statement)?.[1]);
}

function isAWindow(statement: string): boolean {
  return statement.includes(' AS size');
}

const decodePoints = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));

function pointsAskedIn(statement: string): readonly string[] {
  const asked = /jsonb_array_elements_text\("(\[[^]*?\])"::jsonb\) AS taken/u.exec(statement)?.[1];
  return asked === undefined ? [] : decodePoints(asked.replaceAll('\\"', '"'));
}

function aStoreOfTopics(): (statement: string) => readonly unknown[] {
  const checkpoint: { folded: string | null; windows: number } = { folded: '0/0', windows: 0 };
  return (statement) => {
    if (checkpoint.windows > 20) {
      throw new Error('The catch-up did not end');
    }
    if (statement.startsWith('UPDATE projection_checkpoints')) {
      checkpoint.folded = /SET folded_through = "([^"]+)"/u.exec(statement)?.[1] ?? null;
    }
    if (statement.includes('WHERE folded_through IS NOT NULL')) {
      return checkpoint.folded === null
        ? []
        : [{ projection: 'topics', version: 2, folded_through: checkpoint.folded }];
    }
    if (isAWindow(statement)) {
      checkpoint.windows += 1;
      return listed.slice(positionAfter(statement, '>') ?? 0).slice(0, limitOf(statement));
    }
    return pointsAskedIn(statement)
      .map((point) => Number(point.slice('7/'.length)))
      .flatMap((position) => appended.slice(position - 1, position));
  };
}

function sizedAfterItsLimit(statement: string): boolean {
  return /^SELECT m\.transaction_id::text \|\| '\/' \|\| m\.global_position::text AS point, m\.stream_id AS stream, m\.message_type AS type, \(octet_length\(m\.message_data ->> 'json'\)\)::float8 AS size FROM \( SELECT m\.transaction_id, m\.global_position, m\.stream_id, m\.message_type, m\.message_data FROM emt_messages AS m WHERE \(m\.transaction_id, m\.global_position\) > \(split_part\("\d+\/\d+", '\/', 1\)::xid8, split_part\("\d+\/\d+", '\/', 2\)::bigint\) AND m\.partition = "emt:default" AND m\.is_archived = FALSE ORDER BY m\.transaction_id, m\.global_position LIMIT \d+ \) AS m ORDER BY m\.transaction_id, m\.global_position$/u.test(
    statement,
  );
}

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

describe('the reads of a projection on PostgreSQL', () => {
  it('bind every value, read whole numbers as numbers and booleans as booleans', async () => {
    const { query, asked } = answering([stored]);
    const reader = readerOf(query);

    const rows = await Effect.runPromise(
      reader.readProjectedRows('run_tallies', alpha, {
        where: [{ column: 'open', equals: true }],
        orderBy: ['began_at'],
        order: 'desc',
        after: [2000, 'r9'],
        limit: 20,
      }),
    );

    expect(rows).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        key: 'r1',
        row: {
          fn: 'triage',
          began_at: 1000,
          status: 'started',
          facts: 1,
          open: true,
          due_at: 61_000,
          last_message: 'm1',
        },
      },
    ]);
    expect(asked).toEqual([
      {
        text: 'SELECT playbook_key, row_key, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message, (SELECT n.playbook_key FROM definition_names_1 AS n WHERE n.definition_key = t.playbook_key) AS placed_in FROM run_tallies_2 AS t WHERE (playbook_key = $1 OR playbook_key IN (SELECT definition_key FROM definition_names_1 WHERE playbook_key = $2)) AND open = $3 AND (began_at, row_key) < ($4, $5) ORDER BY began_at DESC NULLS LAST, row_key DESC NULLS LAST LIMIT $6',
        values: ['playbook/acme/alpha/', 'playbook/acme/alpha/', true, 2000, 'r9', 20],
      },
    ]);
  });
});

describe('the counts and due times of a projection on PostgreSQL', () => {
  it('count, read what is due across playbooks, and the soonest due time', async () => {
    const counts = answering([{ count: 3 }]);
    const due = answering([stored]);
    const soonest = answering([{ due: 61_000 }]);

    expect(await Effect.runPromise(readerOf(counts.query).countProjectedRows('run_tallies', alpha, []))).toBe(3);
    expect(
      await Effect.runPromise(
        readerOf(due.query).readDueRows('run_tallies', {
          column: 'due_at',
          through: 70_000,
          limit: 256,
        }),
      ),
    ).toMatchObject([{ key: 'r1', row: { open: true } }]);
    expect(await Effect.runPromise(readerOf(soonest.query).nextDueOf('run_tallies', 'due_at', 0))).toBe(61_000);
    expect([...counts.asked, ...due.asked, ...soonest.asked].map(({ text }) => text)).toEqual([
      'SELECT CAST(count(*) AS INTEGER) AS count FROM run_tallies_2 WHERE (playbook_key = $1 OR playbook_key IN (SELECT definition_key FROM definition_names_1 WHERE playbook_key = $2))',
      'SELECT playbook_key, row_key, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message, (SELECT n.playbook_key FROM definition_names_1 AS n WHERE n.definition_key = t.playbook_key) AS placed_in FROM run_tallies_2 AS t WHERE due_at IS NOT NULL AND due_at <= $1 ORDER BY due_at, playbook_key, row_key LIMIT $2',
      'SELECT min(due_at)::float8 AS due FROM run_tallies_2 WHERE due_at IS NOT NULL AND due_at > $1',
    ]);
  });

  it('read, where asked, only a row due with none sooner of its playbook, binding the time each place it is read', async () => {
    const { query, asked } = answering([stored]);
    const firstOfEach = { column: 'due_at', through: 70_000, limit: 256, onePerPlaybook: true };

    await Effect.runPromise(readerOf(query).readDueRows('run_tallies', firstOfEach));

    expect(asked).toEqual([
      {
        text: 'SELECT playbook_key, row_key, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message, (SELECT n.playbook_key FROM definition_names_1 AS n WHERE n.definition_key = t.playbook_key) AS placed_in FROM run_tallies_2 AS t WHERE due_at IS NOT NULL AND due_at <= $1 AND NOT EXISTS (SELECT 1 FROM run_tallies_2 AS s WHERE s.playbook_key = t.playbook_key AND s.due_at IS NOT NULL AND s.due_at <= $2 AND (s.due_at, s.row_key) < (t.due_at, t.row_key)) ORDER BY due_at, playbook_key, row_key LIMIT $3',
        values: [70_000, 70_000, 256],
      },
    ]);
  });

  it('fail for a column the projection does not have', async () => {
    const { query } = answering([]);

    const read = await Effect.runPromiseExit(
      readerOf(query).countProjectedRows('run_tallies', alpha, [{ column: 'state', equals: 'open' }]),
    );

    expect(Exit.isFailure(read)).toBe(true);
  });

  it('bind a boolean as PostgreSQL takes it', () => {
    expect([postgresqlProjectionDialect.booleanOf(true), postgresqlProjectionDialect.booleanOf(false)]).toEqual([
      true,
      false,
    ]);
  });
});

describe('the advance of a row of a projection on PostgreSQL', () => {
  it('updates the columns the reader advances of one row, binding every value, and nothing else', async () => {
    const { query, asked } = answering([]);

    await Effect.runPromise(
      readerOf(query).advanceRow('topics', alpha, 'spring', {
        set: { open: false, next_at: 9000 },
        when: [{ column: 'last_message', equals: 'm-1' }],
      }),
    );
    const refused = await Effect.runPromiseExit(
      readerOf(query).advanceRow('topics', alpha, 'spring', { set: { note: 'x' }, when: [] }),
    );

    expect(Exit.isFailure(refused)).toBe(true);
    expect(asked).toEqual([
      {
        text: 'UPDATE topics_2 SET open = $1, next_at = $2 WHERE playbook_key = $3 AND row_key = $4 AND last_message = $5',
        values: [false, 9000, 'playbook/acme/alpha/', 'spring', 'm-1'],
      },
    ]);
  });
});

describe('the catch-up of a projection keyed by its mapping on PostgreSQL', () => {
  it('locks the rows that hold a position, lists windows in the order of the store, sizing those alone, as many as the window before showed fit, reads the facts it takes by their places, folds every one in order and writes the place reached', async () => {
    const store = recordedAnswering(aStoreOfTopics());

    await keyed.caughtUp((work) => work(store.execute));

    const windows = store.queries.filter((statement) => isAWindow(statement));
    const locks = store.queries.filter((statement) => statement.includes('FROM projection_checkpoints'));
    const advances = store.commands.filter((command) => command.startsWith('UPDATE projection_checkpoints'));
    expect(windows.map((statement) => limitOf(statement))).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512]);
    expect(windows.every((statement) => sizedAfterItsLimit(statement))).toBe(true);
    expect(windows[0]).toContain('> (split_part("0/0", \'/\', 1)::xid8');
    expect(locks.every((statement) => statement.endsWith('WHERE folded_through IS NOT NULL FOR UPDATE'))).toBe(true);
    expect(advances.map((command) => /SET folded_through = (\S+)/u.exec(command)?.[1])).toEqual([
      ...[1, 3, 7, 15, 31, 63, 127, 255, 258].map((point) => `"7/${point}"`),
      'null',
    ]);
    expect(advances[0]).toContain(
      `WHERE projection || '_' || version IN (SELECT jsonb_array_elements_text("[\\"topics_2\\"]"::jsonb) AS value)`,
    );
    expect(store.commands.filter((command) => command.startsWith('INSERT INTO topics_2')).join(' ')).toMatch(
      /"t0".*"t1".*"t2"/u,
    );
  });

  it('pages to the end handed a budget of one page, since the store on PostgreSQL takes none', async () => {
    const store = recordedAnswering(aStoreOfTopics());
    const handedABudget = postgresqlProjectionsOf({ projections: [topicRows], catchUpBudget: { pages: 1 } });

    const state = await handedABudget.caughtUp((work) => work(store.execute));

    const advances = store.commands.filter((command) => command.startsWith('UPDATE projection_checkpoints'));
    expect([state, advances.map((command) => /SET folded_through = (\S+)/u.exec(command)?.[1])]).toEqual([
      'caught_up',
      [...[1, 3, 7, 15, 31, 63, 127, 255, 258].map((point) => `"7/${point}"`), 'null'],
    ]);
  });

  it('ends a window at the next higher position another table holds, through it', () => {
    const window = described(postgresqlCatchUp.window({ after: '7/3', through: '9/2', count: 64 }));

    expect(window).toContain(
      'AND (m.transaction_id, m.global_position) <= (split_part("9/2", \'/\', 1)::xid8, split_part("9/2", \'/\', 2)::bigint)',
    );
    expect(postgresqlCatchUp.orderOf('9/2') > postgresqlCatchUp.orderOf('7/30')).toBe(true);
  });
});

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

type Folded = readonly {
  readonly projection: string;
  readonly version: number;
  readonly folded_through: string | null;
}[];

const tablesOfTheTopics = [{ name: 'topics_1' }, { name: 'topics_2' }];

async function topicsStatementsWith(folded: Folded, tables: readonly unknown[]): Promise<string> {
  const found = recordedAnswering((statement) => {
    if (statement.startsWith('SELECT projection, version, folded_through FROM projection_checkpoints')) {
      return folded;
    }
    return statement.includes('relname ~ "^topics_[0-9]+$"') ? tables : [];
  });
  await keyed.afterTheSchema({ execute: found.execute });
  return found.commands
    .filter((command) => /topics_|INTO projection_checkpoints/u.test(command))
    .map((command) => command.split(' (')[0] ?? '')
    .join('; ');
}

const topicsMade =
  'CREATE TABLE IF NOT EXISTS topics_2; CREATE INDEX IF NOT EXISTS topics_2_due ON topics_2; INSERT INTO projection_checkpoints';

describe('the table of a projection on PostgreSQL as the ledger opens, in the transaction of the migration', () => {
  it('is made at the start of the store where it is missing, dropped first where it has no row, and left as it is, an earlier version beside it, where its row holds a position or says caught up', async () => {
    const atAPosition = [{ projection: 'topics', version: 2, folded_through: '7/9' }];
    const caughtUp = [{ projection: 'topics', version: 2, folded_through: null }];

    const statements = await Promise.all([
      topicsStatementsWith(atAPosition, [{ name: 'topics_1' }]),
      topicsStatementsWith([], tablesOfTheTopics),
      topicsStatementsWith(atAPosition, tablesOfTheTopics),
      topicsStatementsWith(caughtUp, tablesOfTheTopics),
    ]);

    expect(statements).toEqual([topicsMade, `DROP TABLE IF EXISTS topics_2; ${topicsMade}`, '', '']);
  });
});
