import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { streamPortsOf } from '../ledger-service.ts';
import { stamped } from '../testing/happenings.ts';
import { aLedger, aStore, tallies, type LedgerEntry } from '../testing/ledger-entry.ts';
import { tally } from '../testing/tally.ts';

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const aSecondAndSomeMs = 1500;

export function streamAgesBehaviour(entry: LedgerEntry): void {
  describe('the age of the last append to a stream, by the clock of the database', () => {
    it('is how long ago the database took the stream its last fact, within a second, and endless for a stream never appended to', async () => {
      const store = await aStore(entry);
      await store.append(run, [{ type: 'counted', data: { n: 1 } }], { expectedVersion: 0, context: stamped });

      const age = await store.ageOfLastAppend(run);

      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(aSecondAndSomeMs);
      expect(await store.ageOfLastAppend('run/nobody-wrote')).toBe(Number.POSITIVE_INFINITY);
    });

    it('is read through the ledger as the store reads it', async () => {
      const ledger = await aLedger(entry);

      expect(await Effect.runPromise(ledger.ageOfLastAppend('run/nobody-wrote'))).toBe(Number.POSITIVE_INFINITY);
    });
  });
  lastPositionBehaviour(entry);
}

function lastPositionBehaviour(entry: LedgerEntry): void {
  describe('the position of the last fact of a stream', () => {
    it('is the position the store gave the stream its last fact, and none for a stream never appended to', async () => {
      const store = await aStore(entry);
      await store.append(run, [{ type: 'counted', data: { n: 1 } }], { expectedVersion: 0, context: stamped });
      await store.append(
        run,
        [
          { type: 'counted', data: { n: 2 } },
          { type: 'counted', data: { n: 3 } },
        ],
        {
          expectedVersion: 1,
          context: stamped,
        },
      );

      expect([await store.lastPositionOf(run), await store.lastPositionOf('run/nobody-wrote')]).toEqual([3, 0]);
    });

    it('lets a fold whose state is its last fact alone read that fact and no other, at the version of the stream', async () => {
      const store = await aStore(entry);
      const read: (number | undefined)[] = [];
      const counted = {
        ...store,
        read: (stream: string, after?: number) => {
          read.push(after);
          return store.read(stream, after);
        },
      };
      const { load, execute } = streamPortsOf(counted, store.lastPositionOf);
      await Effect.runPromise(execute(tallies, tally, [1, 2]));
      await Effect.runPromise(execute(tallies, tally, [4]));
      read.length = 0;

      const whole = await Effect.runPromise(load(tallies, tally));
      const last = await Effect.runPromise(load(tallies, { ...tally, lastFactAlone: true }));
      const none = await Effect.runPromise(load('org/acme/nothing', { ...tally, lastFactAlone: true }));

      expect([whole, last, none]).toEqual([
        { state: 7, version: 3 },
        { state: 4, version: 3 },
        { state: 0, version: 0 },
      ]);
      expect(read).toEqual([0, 2, 0]);
    });
  });
}
