import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ProjectedRowsQuery } from '../index.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { remarkFacts, remarkRows, type RemarkFact } from './remark-rows.ts';
import { runTallyRows, tallyDueAfterMs } from './tally-rows.ts';
import { topicFacts, topicRows, type TopicFact } from './topic-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

function noting(ledger: MemoryLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, runFacts, facts));
}

function began(fn: string, minute = 0): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minute * 60_000).toISOString(), fn } };
}

function topics(ledger: MemoryLedger, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, topicFacts, facts));
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
