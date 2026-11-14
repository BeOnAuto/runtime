import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '../index.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { topicFacts, topicRows, type TopicFact } from './topic-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

function dueAtNine(row: ProjectedRow | undefined): ProjectedRow | undefined {
  return row === undefined ? undefined : { ...row, due_at: nine };
}

const rewriting: KeyedProjection = {
  ...topicRows,
  rowAfter: (row: ProjectedRow | undefined, message: ProjectedMessage) => dueAtNine(topicRows.rowAfter(row, message)),
};

function topics(ledger: MemoryLedger, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, topicFacts, facts));
}

function notedOn(topic: string, note: string): TopicFact {
  return { type: 'topic_noted', data: { topic, note } };
}

function topicsOf(ledger: MemoryLedger) {
  return Effect.runPromise(
    ledger.service.readProjectedRows('topics', alpha, { where: [], orderBy: [], order: 'asc', limit: 10 }),
  );
}

describe('an advanced column of a row of the in-memory ledger', () => {
  it('keeps what its reader advanced it to through a fact that does not set it, as the ledger’s own tables do', async () => {
    const ledger = memoryLedger(undefined, [rewriting]);
    await topics(ledger, 'playbook/acme/alpha/runs/r1', { type: 'topic_opened', data: { topic: 'spring', at: nine } });
    await Effect.runPromise(ledger.service.advanceRow('topics', alpha, 'spring', { set: { due_at: null }, when: [] }));
    await topics(ledger, 'playbook/acme/alpha/notes/n1', notedOn('spring', 'kept'));
    const noted = (await topicsOf(ledger)).map(({ row }) => [row['note'], row['due_at']]);
    await topics(ledger, 'playbook/acme/alpha/runs/r2', { type: 'topic_opened', data: { topic: 'spring', at: nine } });

    expect(noted).toEqual([['kept', null]]);
    expect((await topicsOf(ledger)).map(({ row }) => row['due_at'])).toEqual([nine]);
  });
});
