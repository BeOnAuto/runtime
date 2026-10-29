import { ActedContextSchema, earlierShapeOf, factOf, readingEarlierShapes, type Decider } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { stamped } from '../testing/happenings.ts';
import { aLedger, tallies, type LedgerEntry } from '../testing/ledger-entry.ts';
import { tally } from '../testing/tally.ts';

const CountedBeforeSchema = factOf('counted', Schema.Struct({ n: Schema.Int }), ActedContextSchema);

const countedBefore: Decider<number, number, typeof CountedBeforeSchema.Type> = {
  initialState: 0,
  evolve: (total, { data }) => total + data.n,
  decide: (n) => Result.succeed([{ type: 'counted', data: { n } }]),
  context: () => stamped,
  eventSchema: CountedBeforeSchema,
};

const talliedAcrossShapes = {
  ...tally,
  eventSchema: readingEarlierShapes(factOf('counted', Schema.Struct({ by: Schema.Int }), ActedContextSchema), [
    earlierShapeOf(CountedBeforeSchema, ({ data, ...fact }) => ({ ...fact, data: { by: data.n } })),
  ]),
};

async function storedIn(entry: LedgerEntry, database: string): Promise<readonly unknown[]> {
  const store = entry.storeOn(database);
  onTestFinished(() => store.close());
  return (await store.read(tallies)).messages.map(({ data }) => data);
}

export function earlierShapesBehaviour(entry: LedgerEntry): void {
  describe('the facts of a stream recorded in an earlier shape', () => {
    it('fold through the reader of their shape beside those of the current shape, which a decision records', async () => {
      const database = await entry.aDatabase();
      await Effect.runPromise((await aLedger(entry, database)).execute(tallies, countedBefore, 3));
      const ledger = await aLedger(entry, database);

      await Effect.runPromise(ledger.execute(tallies, talliedAcrossShapes, [2]));

      expect(await Effect.runPromise(ledger.load(tallies, talliedAcrossShapes))).toEqual({ state: 5, version: 2 });
      expect(await storedIn(entry, database)).toEqual([{ n: 3 }, { by: 2 }]);
    });

    it('fold the same way in the in-memory ledger of the application layer', async () => {
      const ledger = memoryLedger().service;
      await Effect.runPromise(ledger.execute(tallies, countedBefore, 3));

      await Effect.runPromise(ledger.execute(tallies, talliedAcrossShapes, [2]));

      expect(await Effect.runPromise(ledger.load(tallies, talliedAcrossShapes))).toEqual({ state: 5, version: 2 });
    });
  });
}
