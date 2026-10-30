import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { statement, type ConnectionPorts, type Statement } from '@on.auto/ledger';
import { plainPoolsOn } from '@on.auto/ledger/postgresql';
import { Effect, Schema } from 'effect';
import { expect, onTestFinished } from 'vitest';

import { oneRowOf, rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import {
  hostDatabaseOpenedOn,
  ledgerConnectedOn,
  type DatabaseSettings,
} from '../ledger-testing/ledger-connections.ts';
import { until } from './until.ts';

export type { DatabaseSettings } from '../ledger-testing/ledger-connections.ts';

export type SettingsOf = () => Promise<DatabaseSettings>;

const LeaseRow = Schema.Struct({ holder: Schema.String, expires_at: WholeNumber });

export type Lease = typeof LeaseRow.Type;

const leasesRead = statement`SELECT holder, expires_at FROM workflow_leases`;

export function aSQLiteFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-workflow-host-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'ledger.db');
}

export function onSQLite(): Promise<Extract<DatabaseSettings, { readonly store: 'sqlite' }>> {
  return Promise.resolve({ store: 'sqlite', file: aSQLiteFile() });
}

export function onPostgreSQLAt(url: string): DatabaseSettings {
  return { store: 'postgresql', pools: plainPoolsOn(url) };
}

export async function connectedOn(settings: DatabaseSettings): Promise<ConnectionPorts> {
  const { connection, close } = await ledgerConnectedOn(settings);
  onTestFinished(close);
  return connection;
}

export async function openedOn(settings: DatabaseSettings, tables: readonly Statement[] = []): Promise<HostDatabase> {
  const database = await hostDatabaseOpenedOn(settings, tables);
  onTestFinished(database.close);
  return database;
}

export function leaseOn(database: HostDatabase): Promise<Lease> {
  return Effect.runPromise(oneRowOf(LeaseRow, database.read(leasesRead)));
}

export async function leaseHoldersOn(database: HostDatabase): Promise<readonly string[]> {
  const leases = await Effect.runPromise(rowsOf(LeaseRow, database.read(leasesRead)));
  return leases.map(({ holder }) => holder);
}

export async function untilRenewedBy(database: HostDatabase, { holder }: Lease, renewals: number): Promise<void> {
  const expiries = new Set<number>();
  const renewed = await until(
    async () => {
      const lease = await leaseOn(database);
      expiries.add(lease.expires_at);
      return lease;
    },
    () => expiries.size > renewals,
  );
  expect(renewed.holder).toBe(holder);
}
