import type { RunOutcomeMapping } from '@on.auto/operations';
import { runFacts, runTallies, type RunFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import {
  began,
  ended,
  fourRuns,
  fourRunsKept,
  noting,
  reading,
  runOutcomesBehaviour,
  runsOf,
} from './run-outcomes-behaviour.ts';

const breakingDown = 'The mapping broke down';

const failingOnAFailure: RunOutcomeMapping = {
  ...runTallies,
  rowAfter: (row, event) => {
    const kept = runTallies.rowAfter(row, event);
    if (kept?.status === 'failed') {
      throw new Error(breakingDown);
    }
    return kept;
  },
};

function tablesIn(entry: LedgerEntry, database: string): Promise<readonly unknown[]> {
  return entry.queried(database, entry.outcomeTables);
}

async function manyRuns(entry: LedgerEntry, database: string, count: number): Promise<void> {
  const ledger = await aLedger(entry, database);
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: count }, (_, index) => index),
      (index) => ledger.execute(`playbook/acme/alpha/runs/many-${index}`, runFacts, [began('many')]),
      { concurrency: 8, discard: true },
    ),
  );
}

function aProjectionThatBreaksDown(entry: LedgerEntry): void {
  describe('a projection that breaks down inside an append', () => {
    it('fails the append, which keeps nothing, the row it changed before included', async () => {
      const ledger = await aLedger(entry, undefined, failingOnAFailure);
      await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage'));

      await expect(
        noting(ledger, 'playbook/acme/alpha/runs/r1', ended('succeeded', 1), ended('failed', 2)),
      ).rejects.toThrow(breakingDown);
      await expect(noting(ledger, 'playbook/acme/alpha/runs/r2', began('triage'), ended('failed', 2))).rejects.toThrow(
        breakingDown,
      );

      expect(runsOf(await reading(ledger))).toEqual(['2026-10-01 triage started 1']);
      expect(await Effect.runPromise(ledger.load('playbook/acme/alpha/runs/r2', runFacts))).toEqual({
        state: null,
        version: 0,
      });
    });
  });
}

function aStoreWithoutTheProjection(entry: LedgerEntry): void {
  describe('a ledger opened without the projection', () => {
    it('neither creates the table nor changes it, and reads no outcomes', async () => {
      const database = await entry.aDatabase();
      const keeping = await aLedger(entry, database, runTallies);
      await noting(keeping, 'playbook/acme/alpha/runs/r1', began('triage'));
      const fresh = await entry.aDatabase();
      const freshWithout = await aLedger(entry, fresh);
      await noting(freshWithout, 'playbook/acme/alpha/runs/r2', began('triage'));

      const without = await aLedger(entry, database);
      await noting(without, 'playbook/acme/alpha/runs/r1', ended('succeeded', 5));

      expect(runsOf(await reading(keeping))).toEqual(['2026-10-01 triage started 1']);
      expect([await reading(without), await reading(freshWithout)]).toEqual([[], []]);
      expect(await tablesIn(entry, fresh)).toEqual([]);
    });
  });
}

function aNewTableVersion(entry: LedgerEntry): void {
  describe('a table of the outcomes of runs that is not there yet', () => {
    it('is filled when the ledger opens, from every run stream, as the projection keeps it, and earlier versions dropped', async () => {
      const database = await entry.aDatabase();
      const writing = await aLedger(entry, database);
      await fourRuns(writing);
      await noting(writing, 'playbook/acme/alpha/runs/r6', ended('failed', 1), { type: 'run_noted', data: {} });
      await noting(writing, 'playbook/acme/alpha/runs/r7/nested', began('triage'));
      await noting(writing, 'playbook/acme/alpha/runs/r8', { type: 'run_noted', data: {} });
      await manyRuns(entry, database, 1000);
      await entry.queried(database, 'CREATE TABLE run_outcomes_3 (playbook_key text, row_key text)');

      const filled = await aLedger(entry, database, runTallies);

      expect((await reading(filled, { from: '2026-10-01', to: '2026-10-02' }, { name: 'triage' })).length).toBe(2);
      expect(await reading(filled, { from: '2026-10-01', to: '2026-10-02' }, { name: 'many' })).toMatchObject([
        { runs: 1000 },
      ]);
      expect((await reading(filled)).filter(({ name }) => name !== 'many')).toEqual(fourRunsKept);
      expect(await tablesIn(entry, database)).toEqual([{ name: 'run_outcomes_4' }]);
    });
  });
}

function aFillInterruptedOrDone(entry: LedgerEntry): void {
  describe('a fill of the table of the outcomes of runs', () => {
    it('is done again at the next open when it was interrupted, which left nothing behind', async () => {
      const database = await entry.aDatabase();
      await fourRuns(await aLedger(entry, database));
      await noting(await aLedger(entry, database), 'playbook/acme/alpha/runs/r5', began('triage'), ended('failed', 1));

      await expect(openLedgerWith(entry.ledgerOn(database, failingOnAFailure))).rejects.toThrow(breakingDown);
      const tablesAfterTheInterruption = await tablesIn(entry, database);
      const filled = await aLedger(entry, database, runTallies);

      expect(tablesAfterTheInterruption).toEqual([]);
      expect(runsOf(await reading(filled))).toEqual([
        '2026-10-01 triage failed 1',
        '2026-10-01 triage rejected 1',
        '2026-10-01 triage succeeded 2',
        '2026-10-02 draft started 1',
      ]);
    });

    it('is not done again by a ledger that finds the table', async () => {
      const database = await entry.aDatabase();
      await fourRuns(await aLedger(entry, database, runTallies));
      await entry.queried(database, "DELETE FROM run_outcomes_4 WHERE row_key = 'r4'");

      const reopened = await aLedger(entry, database, runTallies);

      expect(runsOf(await reading(reopened))).toEqual([
        '2026-10-01 triage rejected 1',
        '2026-10-01 triage succeeded 2',
      ]);
    });
  });
}

const mebibyte = 1024 * 1024;

function largeEnd(ms: number, note: string): RunFact {
  return { type: 'run_ended', data: { status: 'succeeded', ms, tokens: null, note } };
}

function aFillOfLargeRecords(entry: LedgerEntry): void {
  describe('a fill of run streams whose records are large', () => {
    it('reads them at most 16 MiB at a time, and keeps every run', async () => {
      const database = await entry.aDatabase();
      const writing = await aLedger(entry, database);
      const notes = [1, 1, 1, 6, 6, 6].map((mebibytes) => 'x'.repeat(mebibytes * mebibyte));
      await Effect.runPromise(
        Effect.forEach(
          notes,
          (note, index) =>
            Effect.promise(() =>
              noting(writing, `playbook/acme/alpha/runs/large-${index}`, began('large'), largeEnd(index, note)),
            ),
          { concurrency: 4, discard: true },
        ),
      );

      const filled = await aLedger(entry, database, runTallies);

      expect(runsOf(await reading(filled))).toEqual(['2026-10-01 large succeeded 6']);
    });
  });
}

function aFillOfAnOversizedRun(entry: LedgerEntry): void {
  describe('a fill that meets a run stream holding more than 16 MiB of records', () => {
    it('reads that stream alone, and keeps it and every run after it', async () => {
      const database = await entry.aDatabase();
      const writing = await aLedger(entry, database);
      const note = 'x'.repeat(6 * mebibyte);
      await noting(writing, 'playbook/acme/alpha/runs/over-0', began('over'), largeEnd(0, 'small'));
      await noting(
        writing,
        'playbook/acme/alpha/runs/over-1',
        began('over'),
        largeEnd(1, note),
        largeEnd(2, note),
        largeEnd(3, note),
      );
      await noting(writing, 'playbook/acme/alpha/runs/over-2', began('over'), largeEnd(4, 'small'));
      await noting(writing, 'playbook/acme/alpha/runs/over-3', began('over'), largeEnd(5, 'small'));

      const filled = await aLedger(entry, database, runTallies);

      expect(runsOf(await reading(filled))).toEqual(['2026-10-01 over succeeded 4']);
    });
  });
}

export function runOutcomeTableBehaviour(entry: LedgerEntry): void {
  runOutcomesBehaviour((runOutcomes) => aLedger(entry, undefined, runOutcomes));
  aProjectionThatBreaksDown(entry);
  aStoreWithoutTheProjection(entry);
  aNewTableVersion(entry);
  aFillInterruptedOrDone(entry);
  aFillOfLargeRecords(entry);
  aFillOfAnOversizedRun(entry);
}
