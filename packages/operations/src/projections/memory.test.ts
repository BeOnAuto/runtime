import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeyedProjection, ProjectedMessage, ProjectedRow, ProjectedRowsQuery } from '../index.ts';
import { type RunFact, runFacts } from '../run-outcomes/run-tallies.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { type RemarkFact, remarkFacts, remarkRows } from './remark-rows.ts';
import { runTallyRows, tallyDueAfterMs } from './tally-rows.ts';
import { type TopicFact, topicFacts, topicRows } from './topic-rows.ts';

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

function noting(ledger: MemoryLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, runFacts, facts));
}

function began(fn: string, minute = 0): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minute * 60_000).toISOString(), fn } };
}

const acme = { org: 'acme' };

function remarked(ledger: MemoryLedger, stream: string, ...facts: readonly RemarkFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, remarkFacts, facts));
}

describe('a projection of the streams of playbooks and of orgs, in the in-memory ledger', () => {
  it('keeps the rows of each under its address, reads and counts those of one, and no row of a stream that folds to none', async () => {
    const ledger = memoryLedger(undefined, [remarkRows]);
    await remarked(ledger, 'playbook/acme/alpha/remarks/r1', { type: 'remark_made', data: { text: 'of alpha' } });
    await remarked(ledger, 'org/acme/remarks/r1', { type: 'remark_made', data: { text: 'of acme' } });
    await remarked(ledger, 'org/acme/remarks/r2', { type: 'remark_erased', data: { position: 1 } });
    const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

    expect(
      (await Effect.runPromise(ledger.service.readProjectedRows('remarks', acme, everyRow))).map(
        ({ org, playbook, key, row }) => [org, playbook, key, row['text']],
      ),
    ).toEqual([['acme', undefined, 'r1', 'of acme']]);
    expect(
      (await Effect.runPromise(ledger.service.readProjectedRows('remarks', alpha, everyRow))).map(
        ({ row }) => row['text'],
      ),
    ).toEqual(['of alpha']);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('remarks', acme, []))).toBe(1);
  });
});

describe('the rows due and the advance of a projection of the streams of orgs, in the in-memory ledger', () => {
  it('reads the rows due of both under their addresses, the soonest first', async () => {
    const ledger = memoryLedger(undefined, [{ ...runTallyRows, scopes: ['playbook', 'org'] }]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', 1));
    await noting(ledger, 'org/acme/runs/r2', began('triage', 0));

    const due = await Effect.runPromise(
      ledger.service.readDueRows('run_tallies', { column: 'due_at', through: nine + 2 * tallyDueAfterMs, limit: 5 }),
    );

    expect(due.map(({ org, playbook, key }) => [org, playbook, key])).toEqual([
      ['acme', undefined, 'r2'],
      ['acme', 'alpha', 'r1'],
    ]);
  });

  it('advances a row of an org', async () => {
    const ledger = memoryLedger(undefined, [{ ...topicRows, scopes: ['org'] }]);
    await topics(ledger, 'org/acme/runs/r1', { type: 'topic_opened', data: { topic: 'spring', at: nine } });

    await Effect.runPromise(ledger.service.advanceRow('topics', acme, 'spring', { set: { open: false }, when: [] }));

    expect(
      (
        await Effect.runPromise(
          ledger.service.readProjectedRows('topics', acme, { where: [], orderBy: [], order: 'asc', limit: 5 }),
        )
      ).map(({ key, row }) => [key, row['open']]),
    ).toEqual([['spring', false]]);
  });
});
