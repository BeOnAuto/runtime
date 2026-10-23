import {
  LedgerConnection,
  type AppendObserver,
  type ConnectionPorts,
  type LedgerServices,
  type Statement,
} from '@on.auto/ledger';
import type { PostgreSQLPools } from '@on.auto/ledger/postgresql';
import { Effect, ManagedRuntime, type Layer } from 'effect';

import { hostDatabaseOn, type HostDatabase } from '../database/host-database.ts';
import { hostTablesMadeOn } from '../database/host-tables.ts';
import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';

export type DatabaseSettings =
  | { readonly store: 'sqlite'; readonly file: string; readonly observer?: AppendObserver | undefined }
  | { readonly store: 'postgresql'; readonly pools: PostgreSQLPools; readonly observer?: AppendObserver | undefined };

export interface ConnectedLedger {
  readonly connection: ConnectionPorts;
  readonly close: () => Promise<void>;
}

export interface ClosingHostDatabase extends HostDatabase {
  readonly close: () => Promise<void>;
}

async function ledgerLayerOn(settings: DatabaseSettings): Promise<Layer.Layer<LedgerServices>> {
  if (settings.store === 'sqlite') {
    const { ledgerLayer } = await import('@on.auto/ledger/sqlite3');
    return ledgerLayer({ fileName: settings.file, observer: settings.observer });
  }
  const { postgresqlLedgerLayer } = await import('@on.auto/ledger/postgresql');
  return postgresqlLedgerLayer({ pools: settings.pools, observer: settings.observer });
}

export async function ledgerConnectedOn(settings: DatabaseSettings): Promise<ConnectedLedger> {
  const runtime = ManagedRuntime.make(await ledgerLayerOn(settings));
  try {
    const connection = await runtime.runPromise(Effect.service(LedgerConnection));
    return { connection, close: () => runtime.dispose() };
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

export async function hostDatabaseOpenedOn(
  settings: DatabaseSettings,
  tables: readonly Statement[] = [],
): Promise<ClosingHostDatabase> {
  const { connection, close } = await ledgerConnectedOn(settings);
  try {
    await hostTablesMadeOn(connection, tables);
  } catch (failure) {
    await close();
    throw failure;
  }
  return { ...hostDatabaseOn(connection), close };
}

export async function workflowHostOnALedger(
  settings: DatabaseSettings,
  options: Omit<HostOptions, 'database'>,
): Promise<WorkflowHost> {
  const { connection, close } = await ledgerConnectedOn(settings);
  try {
    const host = await openWorkflowHost({ ...options, database: connection });
    return {
      ...host,
      stop: async () => {
        await host.stop();
        await close();
      },
    };
  } catch (failure) {
    await close();
    throw failure;
  }
}
