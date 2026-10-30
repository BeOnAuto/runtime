import { Conflict } from '@on.auto/operations';
import { Effect, Result, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { storeSignalsBehaviour } from '../signal/store-signals-behaviour.ts';
import { streamAgesBehaviour } from '../stream-ages/stream-ages-behaviour.ts';
import { aLedger, changedWhileDeciding, tallies, type LedgerEntry } from './ledger-entry.ts';
import { outcomeOf } from './open-ledger.ts';
import { tally, tallyInterruptedBy } from './tally.ts';

function ones(count: number): readonly number[] {
  return Array.from({ length: count }, () => 1);
}

function loadingAStream(entry: LedgerEntry): void {
  describe('loading a stream', () => {
    it('gives the initial state at version 0 for a stream nobody wrote', async () => {
      const ledger = await aLedger(entry);

      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 0, version: 0 });
    });
  });
}

function executingACommand(entry: LedgerEntry): void {
  describe('executing a command', () => {
    it('appends the decided events and answers with the folded state and the version after them', async () => {
      const ledger = await aLedger(entry);

      expect(await Effect.runPromise(ledger.execute(tallies, tally, [2, 3]))).toEqual({ state: 5, version: 2 });
      expect(await Effect.runPromise(ledger.execute(tallies, tally, [4]))).toEqual({ state: 9, version: 3 });
      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 9, version: 3 });
    });

    it('answers a rejection as the failure it is and appends nothing', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(tallies, tally, [5]));

      expect(await outcomeOf(ledger.execute(tallies, tally, [-6]))).toEqual(
        Result.fail(new Conflict({ detail: 'A tally of 5 cannot fall to -1' })),
      );
      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 5, version: 1 });
    });

    it('appends nothing for a decision of no events and answers with the current state and version', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(tallies, tally, [1]));

      expect(await Effect.runPromise(ledger.execute(tallies, tally, []))).toEqual({ state: 1, version: 1 });
      expect(await Effect.runPromise(ledger.execute('org/acme/untouched', tally, []))).toEqual({
        state: 0,
        version: 0,
      });
      expect(await Effect.runPromise(ledger.execute('org/acme/untouched', tally, [7]))).toEqual({
        state: 7,
        version: 1,
      });
    });
  });
}

function theSizeOfADecision(entry: LedgerEntry): void {
  const most = entry.mostEventsInOneAppend;

  describe('the size of a decision', () => {
    it(`may be up to ${most} events, appended at once`, async () => {
      const ledger = await aLedger(entry);

      expect(await Effect.runPromise(ledger.execute(tallies, tally, ones(most)))).toEqual({
        state: most,
        version: most,
      });
    });

    it(`is a defect beyond ${most} events, and nothing is appended`, async () => {
      const ledger = await aLedger(entry);

      await expect(outcomeOf(ledger.execute(tallies, tally, ones(most + 1)))).rejects.toThrow(
        `A decision on org/acme/tallies gave ${most + 1} events, more than ${most}`,
      );
      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 0, version: 0 });
    });
  });
}

function writersRacing(entry: LedgerEntry): void {
  describe('writers racing on one stream', () => {
    it('neither lose an update nor share a version', async () => {
      const ledger = await aLedger(entry);
      const writer = Effect.match(ledger.execute(tallies, tally, [1]), {
        onSuccess: Struct.get('version'),
        onFailure: Struct.get('detail'),
      });

      const outcomes = await Effect.runPromise(
        Effect.all(
          Array.from({ length: 6 }, () => writer),
          { concurrency: 6 },
        ),
      );

      const versions = outcomes.filter((outcome) => typeof outcome === 'number');
      const conflicts = outcomes.filter((outcome) => typeof outcome === 'string');
      expect(versions.toSorted((left, right) => left - right)).toEqual(
        Array.from(versions.keys(), (index) => index + 1),
      );
      expect(conflicts).toEqual(conflicts.map(() => changedWhileDeciding));
      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({
        state: versions.length,
        version: versions.length,
      });
    });
  });
}

function aWriterAnotherGotAheadOf(entry: LedgerEntry): void {
  describe('a writer that another writer got ahead of', () => {
    it('decides again against the stream as it now is', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(tallies, tally, [1]));
      const takeOneFirst = Effect.orDie(ledger.execute(tallies, tally, [-1]));

      expect(await Effect.runPromise(ledger.execute(tallies, tallyInterruptedBy(takeOneFirst, 1), [5]))).toEqual({
        state: 5,
        version: 3,
      });
    });

    it('is rejected when the decision taken again no longer holds', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(tallies, tally, [1]));
      const takeOneFirst = Effect.orDie(ledger.execute(tallies, tally, [-1]));

      expect(await outcomeOf(ledger.execute(tallies, tallyInterruptedBy(takeOneFirst, 1), [-1]))).toEqual(
        Result.fail(new Conflict({ detail: 'A tally of 0 cannot fall to -1' })),
      );
      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 0, version: 2 });
    });

    it('gives up with a conflict of a concurrent change after three retries when every append meets a version conflict', async () => {
      const ledger = await aLedger(entry);
      const addOneFirst = Effect.orDie(ledger.execute(tallies, tally, [1]));

      expect(
        await outcomeOf(ledger.execute(tallies, tallyInterruptedBy(addOneFirst, Number.POSITIVE_INFINITY), [10])),
      ).toEqual(Result.fail(new Conflict({ detail: changedWhileDeciding, kind: 'concurrent_change' })));
      expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 4, version: 4 });
    });
  });
}

export function commandsBehaviour(entry: LedgerEntry): void {
  loadingAStream(entry);
  executingACommand(entry);
  theSizeOfADecision(entry);
  writersRacing(entry);
  aWriterAnotherGotAheadOf(entry);
  streamAgesBehaviour(entry);
  storeSignalsBehaviour(entry);
}
