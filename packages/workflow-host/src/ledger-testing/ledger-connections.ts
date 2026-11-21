import { LedgerConnection, type ConnectionPorts, type Statement } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';

import { hostDatabaseOn, type HostDatabase } from '../database/host-database.ts';
import { hostTablesMadeOn } from '../database/host-tables.ts';
import type { FactPayloads } from '../follower/followed-events.ts';
import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import { factPayloadsIn } from '../runs/run-payloads.ts';
import { boundedConnection } from './bounded-connection.ts';
import { ledgerLayerOn, type DatabaseSettings } from './ledger-layers.ts';

export type { DatabaseSettings } from './ledger-layers.ts';

export interface ConnectedLedger {
  readonly connection: ConnectionPorts;
  readonly ledger: Ledger['Service'];
  readonly close: () => Promise<void>;
}

export interface ClosingHostDatabase extends HostDatabase {
  readonly close: () => Promise<void>;
}

export interface HostBesideItsLedger {
  readonly database: ClosingHostDatabase;
  readonly ledger: Ledger['Service'];
}

export async function ledgerConnectedOn(settings: DatabaseSettings): Promise<ConnectedLedger> {
  const runtime = ManagedRuntime.make(await ledgerLayerOn(settings));
  try {
    const connection = await runtime.runPromise(Effect.service(LedgerConnection));
    const { mostBoundValues } = settings;
    return {
      connection: mostBoundValues === undefined ? connection : boundedConnection(connection, mostBoundValues),
      ledger: await runtime.runPromise(Effect.service(Ledger)),
      close: () => runtime.dispose(),
    };
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

export async function hostBesideItsLedgerOn(
  settings: DatabaseSettings,
  tables: readonly Statement[] = [],
): Promise<HostBesideItsLedger> {
  const { connection, ledger, close } = await ledgerConnectedOn(settings);
  try {
    await hostTablesMadeOn(connection, tables);
  } catch (failure) {
    await close();
    throw failure;
  }
  return { database: { ...hostDatabaseOn(connection), close }, ledger };
}

export async function hostDatabaseOpenedOn(
  settings: DatabaseSettings,
  tables: readonly Statement[] = [],
): Promise<ClosingHostDatabase> {
  const { database } = await hostBesideItsLedgerOn(settings, tables);
  return database;
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

export function factPayloadsOn({ content }: Pick<HostDatabase, 'content'>): FactPayloads {
  return factPayloadsIn(content);
}
