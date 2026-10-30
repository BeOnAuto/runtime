import type { RecordedSelection } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  details,
  happen,
  happenings,
  inAlpha,
  noted,
  reading,
  streamsAndTypes,
  type AnyLedger,
  type LedgerMaker,
} from './happenings.ts';

const runs: RecordedSelection = { kind: 'runs' };

function theRunsAPageExamines(aLedger: LedgerMaker): void {
  describe('the runs a page of runs examines', () => {
    it('are at most 1,000, so a page that finds none of the status asked for still carries a cursor', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('runs/oldest'), noted('run_started'), noted('run_failed'));
      await Effect.runPromise(
        Effect.forEach(
          Array.from({ length: 1000 }, (_, index) => index),
          (index) => ledger.execute(inAlpha(`runs/run-${index}`), happenings, [noted('run_started')]),
          { concurrency: 8, discard: true },
        ),
      );

      const page = { order: 'desc', limit: 20, types: ['run_failed'] } as const;
      const first = await reading(ledger, runs, page);
      const rest = await reading(ledger, runs, { ...page, cursor: String(first.nextCursor) });

      expect([first.records.length, first.hasMore, streamsAndTypes(rest), rest.nextCursor]).toEqual([
        0,
        true,
        ['playbook/acme/alpha/runs/oldest run_started', 'playbook/acme/alpha/runs/oldest run_failed'],
        null,
      ]);
    });
  });
}

function theStreamsOfOneRun(aLedger: LedgerMaker): void {
  describe('the read of one run', () => {
    it('gives the messages of its run stream and its run log, in order, and nothing else', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('runs/r1'), noted('run_started'));
      await happen(ledger, inAlpha('run-logs/r1'), noted('input_applied'));
      await happen(ledger, inAlpha('runs/r10'), noted('run_started'));
      await happen(ledger, inAlpha('run-logs/r1x'), noted('input_applied'));
      await happen(ledger, 'playbook/acme/beta/runs/r1', noted('run_started'));
      await happen(ledger, inAlpha('runs/r1'), noted('run_succeeded'));

      const page = await reading(ledger, { kind: 'run', run: 'r1' }, { order: 'asc', limit: 10 });
      const succeeded = await reading(
        ledger,
        { kind: 'run', run: 'r1' },
        { order: 'desc', limit: 10, types: ['run_succeeded'] },
      );

      expect(streamsAndTypes(succeeded)).toEqual(['playbook/acme/alpha/runs/r1 run_succeeded']);
      expect(streamsAndTypes(page)).toEqual([
        'playbook/acme/alpha/runs/r1 run_started',
        'playbook/acme/alpha/run-logs/r1 input_applied',
        'playbook/acme/alpha/runs/r1 run_succeeded',
      ]);
    });
  });
}

async function threeRuns(ledger: AnyLedger): Promise<void> {
  await happen(ledger, inAlpha('runs/r1'), noted('run_started', 'r1'));
  await happen(ledger, inAlpha('run-logs/r1'), noted('input_applied'));
  await happen(ledger, inAlpha('runs/r2'), noted('run_started', 'r2'));
  await happen(ledger, inAlpha('runs/r3'), noted('run_started', 'r3'));
  await happen(ledger, inAlpha('notes'), noted('noted'));
  await happen(ledger, inAlpha('runs/r1'), noted('run_succeeded', 'r1 done'));
  await happen(ledger, inAlpha('runs/r3'), noted('run_failed', 'r3 done'));
  await happen(ledger, 'playbook/acme/alpha2/runs/r4', noted('run_started', 'r4'));
}

function theRunsOfAPlaybook(aLedger: LedgerMaker): void {
  describe('the read of the runs of a playbook', () => {
    it('gives the first and the latest message of every run, by the position of its first, either way', async () => {
      const ledger = await aLedger();
      await threeRuns(ledger);

      const pages = await Promise.all([
        reading(ledger, runs, { order: 'desc', limit: 10 }),
        reading(ledger, runs, { order: 'asc', limit: 2 }),
      ]);

      expect(pages.map((page) => [details(page), page.hasMore])).toEqual([
        [['r3', 'r3 done', 'r2', 'r1', 'r1 done'], false],
        [['r1', 'r1 done', 'r2'], true],
      ]);
    });

    it('keeps to the runs whose latest message is of the types asked for', async () => {
      const ledger = await aLedger();
      await threeRuns(ledger);

      const pages = await Promise.all(
        ([['run_failed'], ['run_started'], ['run_succeeded', 'run_failed']] as const).map((types) =>
          reading(ledger, runs, { order: 'desc', limit: 10, types }),
        ),
      );

      expect(pages.map((page) => details(page))).toEqual([
        ['r3', 'r3 done'],
        ['r2'],
        ['r3', 'r3 done', 'r1', 'r1 done'],
      ]);
    });
  });
}

const runsOnly: RecordedSelection = { kind: 'runs', notBeginningWith: ['run_cancel_requested'] };

const newestHundred = { order: 'desc', limit: 100 } as const;

function streamsBeginningWith(ledger: AnyLedger, firstTypes: readonly string[]): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(firstTypes, (type, index) => ledger.execute(inAlpha(`runs/s${index}`), happenings, [noted(type)]), {
      concurrency: 8,
      discard: true,
    }),
  );
}

function runsWithOneLeftOutEvery(every: number, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => (index % every === 0 ? 'run_cancel_requested' : 'run_started'));
}

function pageFigures({ records, hasMore }: Awaited<ReturnType<typeof reading>>): readonly [number, boolean, boolean] {
  return [records.length, hasMore, records.some(({ type }) => type === 'run_cancel_requested')];
}

function theRunsLeavingOutSomeStreams(aLedger: LedgerMaker): void {
  describe('the read of runs that leaves out the streams beginning with some types', () => {
    it('fills its page from the runs among them, and has no more once they are read', async () => {
      const ledger = await aLedger();
      await streamsBeginningWith(ledger, runsWithOneLeftOutEvery(21, 105));

      const page = await reading(ledger, runsOnly, newestHundred);

      expect(pageFigures(page)).toEqual([100, false, false]);
    });

    it('has no more after the last run when the oldest stream is left out', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('runs/oldest'), noted('run_cancel_requested'));
      await streamsBeginningWith(ledger, runsWithOneLeftOutEvery(101, 101).slice(1));

      const pages = await Promise.all([reading(ledger, runsOnly, newestHundred), reading(ledger, runs, newestHundred)]);

      expect(pages.map((page) => pageFigures(page))).toEqual([
        [100, false, false],
        [100, true, false],
      ]);
    });
  });
}

const withNul = { text: 'a NUL \u0000 inside', also: 'half a pair \uD800 alone' };

function aRunHoldingU0000(aLedger: LedgerMaker): void {
  describe('a run whose input and output hold U+0000', () => {
    it('is listed, filtered and read, its data exactly as it was decided', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('runs/r1'), noted('run_started', { input: withNul }));
      await happen(ledger, inAlpha('runs/r1'), noted('run_succeeded', { output: withNul }));

      const pages = await Promise.all([
        reading(ledger, runs, { order: 'desc', limit: 10 }),
        reading(ledger, runs, { order: 'desc', limit: 10, types: ['run_succeeded'] }),
        reading(ledger, { kind: 'run', run: 'r1' }, { order: 'asc', limit: 10 }),
      ]);

      const decided = [{ input: withNul }, { output: withNul }];
      expect(pages.map((page) => details(page))).toEqual([decided, decided, decided]);
    });
  });
}

export function runsBehaviour(aLedger: LedgerMaker): void {
  theRunsAPageExamines(aLedger);
  theStreamsOfOneRun(aLedger);
  theRunsOfAPlaybook(aLedger);
  theRunsLeavingOutSomeStreams(aLedger);
  aRunHoldingU0000(aLedger);
}
