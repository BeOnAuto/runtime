import type { KeyedProjection, Ledger, ProjectedCondition, ProjectedRowsQuery } from '@on.auto/operations';
import { runFacts, runTallyRows, tallyDueAfterMs, type RunFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

type AnyLedger = Ledger['Service'];

type ProjectingLedger = (projections: readonly KeyedProjection[]) => Promise<AnyLedger>;

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

const minute = 60_000;

const ended: RunFact = { type: 'run_ended', data: { status: 'succeeded', ms: 10, tokens: null } };

const newestFirst: ProjectedRowsQuery = { where: [], orderBy: ['began_at'], order: 'desc', limit: 10 };

function began(fn: string, minutes: number): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minutes * minute).toISOString(), fn } };
}

type Noted = readonly (readonly [string, readonly RunFact[]])[];

async function ledgerOfRuns(open: ProjectingLedger, noted: Noted): Promise<AnyLedger> {
  const ledger = await open([runTallyRows]);
  await Effect.runPromise(Effect.forEach(noted, ([stream, facts]) => ledger.execute(stream, runFacts, facts)));
  return ledger;
}

const fourRuns: Noted = [
  ['playbook/acme/alpha/runs/r1', [began('triage', 0)]],
  ['playbook/acme/alpha/runs/r2', [began('triage', 1), ended]],
  ['playbook/acme/alpha/runs/r3', [began('review', 2)]],
  ['playbook/acme/beta/runs/r4', [began('triage', 3)]],
];

const fiveRunsOfAlpha: Noted = [
  ['playbook/acme/alpha/runs/r1', [began('triage', 0)]],
  ['playbook/acme/alpha/runs/r2', [began('triage', 1)]],
  ['playbook/acme/alpha/runs/r3', [began('review', 2)]],
  ['playbook/acme/alpha/runs/r4', [began('triage', 3)]],
  ['playbook/acme/alpha/runs/r5', [began('triage', 4)]],
];

async function runsOf(ledger: AnyLedger, query: ProjectedRowsQuery): Promise<readonly string[]> {
  return (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, query))).map(({ key }) => key);
}

function runsWhere(ledger: AnyLedger, ...where: readonly ProjectedCondition[]): Promise<readonly string[]> {
  return runsOf(ledger, { ...newestFirst, where });
}

function countedWhere(ledger: AnyLedger, ...where: readonly ProjectedCondition[]): Promise<number> {
  return Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, where));
}

function rowsAfterAndBefore(open: ProjectingLedger): void {
  it('reads and counts the rows whose number or text column comes strictly after or before it, and none whose column is not set', async () => {
    const ledger = await ledgerOfRuns(open, fourRuns);

    expect(await runsWhere(ledger, { column: 'began_at', after: nine })).toEqual(['r3', 'r2']);
    expect(await runsWhere(ledger, { column: 'began_at', before: nine + 2 * minute })).toEqual(['r2', 'r1']);
    expect(
      await runsWhere(ledger, { column: 'began_at', after: nine }, { column: 'began_at', before: nine + 2 * minute }),
    ).toEqual(['r2']);
    expect(await runsWhere(ledger, { column: 'fn', before: 'triage' })).toEqual(['r3']);
    expect(await runsWhere(ledger, { column: 'fn', after: 'review' })).toEqual(['r2', 'r1']);
    expect(await runsWhere(ledger, { column: 'row_key', after: 'r1' })).toEqual(['r3', 'r2']);
    expect(await runsWhere(ledger, { column: 'due_at', after: 0 })).toEqual(['r3', 'r1']);
    expect(await runsWhere(ledger, { column: 'due_at', before: nine + 2 * minute + tallyDueAfterMs })).toEqual(['r1']);
    expect(await countedWhere(ledger, { column: 'began_at', after: nine })).toBe(2);
    expect(await countedWhere(ledger, { column: 'fn', after: 'review' }, { column: 'open', equals: true })).toBe(1);
    expect(await countedWhere(ledger, { column: 'due_at', before: Number.MAX_SAFE_INTEGER })).toBe(2);
  });
}

function rowsPaged(open: ProjectingLedger): void {
  it('pages by them beside equal columns, in order either way, from where a page ended', async () => {
    const ledger = await ledgerOfRuns(open, fiveRunsOfAlpha);
    const triageAfterNine: ProjectedRowsQuery = {
      ...newestFirst,
      where: [
        { column: 'fn', equals: 'triage' },
        { column: 'began_at', after: nine },
      ],
      limit: 2,
    };

    expect(await runsOf(ledger, triageAfterNine)).toEqual(['r5', 'r4']);
    expect(await runsOf(ledger, { ...triageAfterNine, after: [nine + 3 * minute, 'r4'] })).toEqual(['r2']);
    expect(await runsOf(ledger, { ...triageAfterNine, order: 'asc' })).toEqual(['r2', 'r4']);
    expect(await runsOf(ledger, { ...triageAfterNine, order: 'asc', after: [nine + 3 * minute, 'r4'] })).toEqual([
      'r5',
    ]);
    expect(
      await runsOf(ledger, {
        ...newestFirst,
        where: [{ column: 'row_key', before: 'r5' }],
        orderBy: ['fn', 'began_at'],
        limit: 2,
        after: ['triage', nine + 3 * minute, 'r4'],
      }),
    ).toEqual(['r2', 'r1']);
  });
}

const refusedConditions: readonly (readonly [ProjectedCondition, string])[] = [
  [{ column: 'state', after: 'a' }, 'The projection run_tallies has no column state'],
  [{ column: 'open', before: 1 }, 'The projection run_tallies cannot compare its boolean column open with 1'],
  [
    { column: 'began_at', after: 'noon' },
    'The projection run_tallies cannot compare its integer column began_at with "noon"',
  ],
  [{ column: 'fn', before: 1 }, 'The projection run_tallies cannot compare its text column fn with 1'],
];

function conditionsRefused(open: ProjectingLedger): void {
  it.each(refusedConditions)(
    'refuses the condition %j in a read, a count and an advance',
    async (condition, refusal) => {
      const ledger = await ledgerOfRuns(open, fourRuns);

      await expect(
        Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, { ...newestFirst, where: [condition] })),
      ).rejects.toThrow(refusal);
      await expect(Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, [condition]))).rejects.toThrow(
        refusal,
      );
      await expect(
        Effect.runPromise(ledger.advanceRow('run_tallies', alpha, 'r1', { set: {}, when: [condition] })),
      ).rejects.toThrow(refusal);
    },
  );
}

export function comparedRowsBehaviour(open: ProjectingLedger): void {
  describe('a read of the rows of a playbook by a column compared with a value', () => {
    rowsAfterAndBefore(open);
    rowsPaged(open);
    conditionsRefused(open);
  });
}
