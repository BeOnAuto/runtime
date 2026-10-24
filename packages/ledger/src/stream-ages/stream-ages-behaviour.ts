import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { stamped } from '../testing/happenings.ts';
import { aLedger, aStore, type LedgerEntry } from '../testing/ledger-entry.ts';

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
}
