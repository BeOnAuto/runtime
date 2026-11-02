import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ProjectedCondition, ProjectedRowsQuery } from '../index.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { runTallyRows, tallyDueAfterMs } from './tally-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

const minute = 60_000;

const newestFirst: ProjectedRowsQuery = { where: [], orderBy: ['began_at'], order: 'desc', limit: 10 };

function began(fn: string, minutes: number): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minutes * minute).toISOString(), fn } };
}

const ended: RunFact = { type: 'run_ended', data: { status: 'succeeded', ms: 10, tokens: null } };

async function ledgerOfRuns(): Promise<MemoryLedger> {
  const ledger = memoryLedger(undefined, [runTallyRows]);
  const noted: readonly (readonly [string, readonly RunFact[]])[] = [
    ['playbook/acme/alpha/runs/r1', [began('triage', 0)]],
    ['playbook/acme/alpha/runs/r2', [began('triage', 1), ended]],
    ['playbook/acme/alpha/runs/r3', [began('review', 2)]],
    ['playbook/acme/beta/runs/r4', [began('triage', 3)]],
  ];
  await Effect.runPromise(Effect.forEach(noted, ([stream, facts]) => ledger.service.execute(stream, runFacts, facts)));
  return ledger;
}

async function runsWhere(ledger: MemoryLedger, ...where: readonly ProjectedCondition[]) {
  return (
    await Effect.runPromise(ledger.service.readProjectedRows('run_tallies', alpha, { ...newestFirst, where }))
  ).map(({ key }) => key);
}

const refusedConditions: readonly (readonly [ProjectedCondition, string])[] = [
  [{ column: 'state', equals: 'open' }, 'The projection run_tallies has no column state'],
  [{ column: 'open', after: 0 }, 'The projection run_tallies cannot compare its boolean column open with 0'],
  [
    { column: 'began_at', before: 'noon' },
    'The projection run_tallies cannot compare its integer column began_at with "noon"',
  ],
  [{ column: 'fn', after: 1 }, 'The projection run_tallies cannot compare its text column fn with 1'],
];

describe('a condition of a read of projected rows in the in-memory ledger', () => {
  it('reads the rows whose number or text column comes strictly after or before a value, and none whose column is not set', async () => {
    const ledger = await ledgerOfRuns();

    expect(await runsWhere(ledger, { column: 'began_at', after: nine })).toEqual(['r3', 'r2']);
    expect(await runsWhere(ledger, { column: 'began_at', before: nine + 2 * minute })).toEqual(['r2', 'r1']);
    expect(await runsWhere(ledger, { column: 'fn', before: 'triage' })).toEqual(['r3']);
    expect(await runsWhere(ledger, { column: 'fn', after: 'review' })).toEqual(['r2', 'r1']);
    expect(await runsWhere(ledger, { column: 'row_key', after: 'r1' }, { column: 'row_key', before: 'r3' })).toEqual([
      'r2',
    ]);
    expect(await runsWhere(ledger, { column: 'due_at', after: 0 })).toEqual(['r3', 'r1']);
    expect(await runsWhere(ledger, { column: 'due_at', before: nine + 2 * minute + tallyDueAfterMs })).toEqual(['r1']);
  });

  it('pages and counts by them beside equal columns', async () => {
    const ledger = await ledgerOfRuns();
    const triageAfterNine: readonly ProjectedCondition[] = [
      { column: 'fn', equals: 'triage' },
      { column: 'began_at', after: nine - 1 },
    ];

    expect(
      await Effect.runPromise(
        ledger.service.readProjectedRows('run_tallies', alpha, {
          ...newestFirst,
          where: triageAfterNine,
          after: [nine + minute, 'r2'],
        }),
      ),
    ).toMatchObject([{ key: 'r1' }]);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('run_tallies', alpha, triageAfterNine))).toBe(2);
  });
});

describe('a condition the in-memory ledger refuses', () => {
  it.each(refusedConditions)(
    'refuses the condition %j in a read, a count and an advance',
    async (condition, refusal) => {
      const ledger = await ledgerOfRuns();

      await expect(
        Effect.runPromise(
          ledger.service.readProjectedRows('run_tallies', alpha, { ...newestFirst, where: [condition] }),
        ),
      ).rejects.toThrow(refusal);
      await expect(
        Effect.runPromise(ledger.service.countProjectedRows('run_tallies', alpha, [condition])),
      ).rejects.toThrow(refusal);
      await expect(
        Effect.runPromise(ledger.service.advanceRow('run_tallies', alpha, 'r1', { set: {}, when: [condition] })),
      ).rejects.toThrow(refusal);
    },
  );

  it('is not read for a projection the ledger does not keep', async () => {
    const ledger = await ledgerOfRuns();

    expect(
      await Effect.runPromise(ledger.service.countProjectedRows('nothing', alpha, [{ column: 'state', after: 1 }])),
    ).toBe(0);
    expect(
      await Effect.runPromise(
        ledger.service.readProjectedRows('nothing', alpha, { ...newestFirst, where: [{ column: 'state', after: 1 }] }),
      ),
    ).toEqual([]);
  });
});
