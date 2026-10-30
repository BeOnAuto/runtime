import { aSQLiteFileInLayout, ledgerLayer } from '@on.auto/ledger/sqlite3';
import { ledgerLayout, ledgerLayoutFloor } from '@on.auto/ledger/testing';
import { ActedContextSchema, Ledger, type Decided, type Decider } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';

export const anEarlierLayout = ledgerLayoutFloor - 1;

export const aNewerLayout = ledgerLayout + 1;

export function aLedgerOfAnEarlierVersionAt(file: string): Promise<void> {
  return aSQLiteFileInLayout(file, anEarlierLayout);
}

export function aLedgerOfANewerVersionAt(file: string): Promise<void> {
  return aSQLiteFileInLayout(file, aNewerLayout);
}

export const aFactOfAnEarlierVersion = 'metering_faulted';

export const aFactInAnEarlierShape = { type: 'license_key_kept', data: { key_id: 'key-1' } } as const;

const AnyFactSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ActedContextSchema });

type AnyFact = typeof AnyFactSchema.Type;

const recordedAsGiven: Decider<null, Decided<AnyFact>, AnyFact> = {
  initialState: null,
  evolve: () => null,
  decide: (fact) => Result.succeed([fact]),
  context: () => ({ at: '2026-10-01T09:00:00.000Z', by: 'runtime' }),
  eventSchema: AnyFactSchema,
};

async function aLedgerHoldingAt(file: string, fact: Decided<AnyFact>): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName: file }));
  await runtime.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.execute('meter', recordedAsGiven, fact);
    }),
  );
  await runtime.dispose();
}

export function aLedgerHoldingAFactOfAnEarlierVersionAt(file: string): Promise<void> {
  return aLedgerHoldingAt(file, { type: aFactOfAnEarlierVersion, data: {} });
}

export function aLedgerHoldingAFactInAnEarlierShapeAt(file: string): Promise<void> {
  return aLedgerHoldingAt(file, aFactInAnEarlierShape);
}
