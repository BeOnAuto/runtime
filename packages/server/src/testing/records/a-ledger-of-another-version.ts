import { aSQLiteFileInLayout, ledgerLayer } from '@on.auto/ledger/sqlite3';
import { ledgerLayout, ledgerLayoutFloor } from '@on.auto/ledger/testing';
import { ContextSchema, Ledger, type Context, type Decided, type Decider } from '@on.auto/operations';
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

export const aFactOfAPredictionBuild = 'version_built';

const AnyFactSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

type AnyFact = typeof AnyFactSchema.Type;

interface Held {
  readonly stream: string;
  readonly fact: Decided<AnyFact>;
  readonly context: Context;
}

const recordedAsGiven: Decider<null, Held, AnyFact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ context }) => context,
  eventSchema: AnyFactSchema,
};

const at = '2026-10-01T09:00:00.000Z';

const byTheRuntime: Context = { at, by: 'runtime' };

const aRunOfAPredictionFunction = '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const ofThePredictionFunction = {
  at,
  by: 'key_7f3a',
  definitionType: 'prediction',
  definitionName: 'daily-visits',
  definitionVersion: 1,
};

async function aLedgerHoldingAt(file: string, held: Held): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName: file }));
  await runtime.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.execute(held.stream, recordedAsGiven, held);
    }),
  );
  await runtime.dispose();
}

export function aLedgerHoldingAFactOfAnEarlierVersionAt(file: string): Promise<void> {
  return aLedgerHoldingAt(file, {
    stream: 'meter',
    fact: { type: aFactOfAnEarlierVersion, data: {} },
    context: byTheRuntime,
  });
}

export function aLedgerHoldingAFactInAnEarlierShapeAt(file: string): Promise<void> {
  return aLedgerHoldingAt(file, { stream: 'meter', fact: aFactInAnEarlierShape, context: byTheRuntime });
}

export function aLedgerHoldingAPredictionBuildAt(file: string): Promise<void> {
  return aLedgerHoldingAt(file, {
    stream: 'playbook/acme/alpha/definitions/prediction',
    fact: { type: aFactOfAPredictionBuild, data: { version: 1, build: aRunOfAPredictionFunction } },
    context: ofThePredictionFunction,
  });
}

export function aLedgerHoldingAPredictionRejectedAt(file: string, kind: string): Promise<void> {
  return aLedgerHoldingAt(file, {
    stream: `playbook/acme/alpha/runs/${aRunOfAPredictionFunction}`,
    fact: { type: 'run_rejected', data: { rejection: { reason: 'unavailable', kind, detail: 'Refused' } } },
    context: { ...ofThePredictionFunction, runId: aRunOfAPredictionFunction },
  });
}
