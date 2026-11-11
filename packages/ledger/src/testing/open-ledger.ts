import { Ledger } from '@on.auto/operations';
import type { SecretRows } from '@on.auto/secrets';
import { Effect, ManagedRuntime, type Layer, type Result } from 'effect';

import { LedgerConnection, type ConnectionPorts } from '../connection/ledger-connection.ts';
import { LedgerChores } from '../content/content-sweep.ts';
import type { SQLiteLedgerFile } from '../secrets/sqlite-ledger-file.ts';
import type { ReceivedWebhooks } from '../webhooks/received-webhooks.ts';

export interface OpenLedger {
  readonly ledger: Ledger['Service'];
  readonly dispose: () => Promise<void>;
}

export interface OpenConnection extends OpenLedger {
  readonly connection: ConnectionPorts;
}

export interface OpenChores extends OpenLedger {
  readonly sweptAt: (now: number) => Promise<number>;
  readonly waitsEnded: () => Promise<void>;
}

export async function openLedgerWith(layer: Layer.Layer<Ledger>): Promise<OpenLedger> {
  const runtime = ManagedRuntime.make(layer);
  const ledger = await runtime.runPromise(Ledger);
  return { ledger, dispose: () => runtime.dispose() };
}

export async function openConnectionWith(layer: Layer.Layer<Ledger | LedgerConnection>): Promise<OpenConnection> {
  const runtime = ManagedRuntime.make(layer);
  const [ledger, connection] = await runtime.runPromise(
    Effect.all([Effect.service(Ledger), Effect.service(LedgerConnection)]),
  );
  return { ledger, connection, dispose: () => runtime.dispose() };
}

export async function openChoresWith(layer: Layer.Layer<Ledger | LedgerChores>): Promise<OpenChores> {
  const runtime = ManagedRuntime.make(layer);
  const [ledger, chores] = await runtime.runPromise(Effect.all([Effect.service(Ledger), Effect.service(LedgerChores)]));
  return {
    ledger,
    sweptAt: (now) => runtime.runPromise(chores.sweepOrphans(now)),
    waitsEnded: () => runtime.runPromise(chores.endWaits),
    dispose: () => runtime.dispose(),
  };
}

export function outcomeOf<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}

function openedWithItsLedger<Rows extends { readonly close: () => Promise<void> }>(
  file: SQLiteLedgerFile,
  rowsOfTheFile: Effect.Effect<Rows>,
): Effect.Effect<Rows> {
  return Effect.promise(async () => {
    const runtime = ManagedRuntime.make(file.ledgerLayer());
    const rows = await runtime.runPromise(Effect.andThen(Ledger, rowsOfTheFile));
    return { ...rows, close: () => runtime.dispose() };
  });
}

export function secretRowsOfItsOpenLedger(file: SQLiteLedgerFile): Effect.Effect<SecretRows> {
  return openedWithItsLedger(file, file.secretRows);
}

export function receivedWebhooksOfItsOpenLedger(file: SQLiteLedgerFile): Effect.Effect<ReceivedWebhooks> {
  return openedWithItsLedger(file, file.receivedWebhooks);
}
