import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime, type Layer, type Result } from 'effect';

import { LedgerConnection, type ConnectionPorts } from '../connection/ledger-connection.ts';
import { ledgerLayer } from '../sqlite3.ts';

export interface OpenLedger {
  readonly ledger: Ledger['Service'];
  readonly dispose: () => Promise<void>;
}

export interface OpenConnection extends OpenLedger {
  readonly connection: ConnectionPorts;
}

export async function openLedgerWith(layer: Layer.Layer<Ledger>): Promise<OpenLedger> {
  const runtime = ManagedRuntime.make(layer);
  const ledger = await runtime.runPromise(Ledger);
  return { ledger, dispose: () => runtime.dispose() };
}

export function openLedger(fileName = ':memory:'): Promise<OpenLedger> {
  return openLedgerWith(ledgerLayer({ fileName }));
}

export async function openConnection(fileName = ':memory:'): Promise<OpenConnection> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  const [ledger, connection] = await runtime.runPromise(
    Effect.all([Effect.service(Ledger), Effect.service(LedgerConnection)]),
  );
  return { ledger, connection, dispose: () => runtime.dispose() };
}

export function outcomeOf<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}
