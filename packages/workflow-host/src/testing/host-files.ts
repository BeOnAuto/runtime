import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { statement, type ConnectionPorts, type Statement } from '@on.auto/ledger';
import { plainPoolsOn } from '@on.auto/ledger/postgresql';
import { Effect, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { hostDatabaseOn, oneRowOf, rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { hostTablesMadeOn } from '../database/host-tables.ts';
import {
  hostBesideItsLedgerOn,
  hostDatabaseOpenedOn,
  ledgerConnectedOn,
  type DatabaseSettings,
  type HostBesideItsLedger,
} from '../ledger-testing/ledger-connections.ts';

export type { DatabaseSettings } from '../ledger-testing/ledger-connections.ts';

export type SettingsOf = () => Promise<DatabaseSettings>;

/** Where a test's ledger is: settings each opening connects anew, or one connection opened already, which each shares. */
export type LedgerOn = DatabaseSettings | ConnectionPorts;

function isOpened(ledger: LedgerOn): ledger is ConnectionPorts {
  return 'dialect' in ledger;
}

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

/** A ledger and its host's tables on SQLite in memory: one connection, gone once it closes, for a rule that is not the store's. */
export function onSQLite(): Promise<Extract<DatabaseSettings, { readonly store: 'sqlite' }>> {
  return Promise.resolve({ store: 'sqlite', file: ':memory:' });
}

type InMemory = Pick<DatabaseSettings, 'holders' | 'mostBoundValues'>;

/**
 * A ledger on SQLite in memory, opened once: the host and the test's reader each given it share its one connection,
 * where each opening of `':memory:'` would be a database of its own.
 */
export function aLedgerInMemory(bound: InMemory = {}): Promise<ConnectionPorts> {
  return connectedOn({ store: 'sqlite', file: ':memory:', ...bound });
}

/**
 * A ledger on a SQLite file of its own, for a test that opens one database anew where one shared connection would not
 * do (a host started again, another process) or proves the store's own contract.
 */
export function onASQLiteFile(): Promise<Extract<DatabaseSettings, { readonly store: 'sqlite' }>> {
  return Promise.resolve({ store: 'sqlite', file: aSQLiteFile() });
}

export function onPostgreSQLAt(url: string): DatabaseSettings {
  return { store: 'postgresql', pools: plainPoolsOn(url) };
}

export async function connectedOn(ledger: LedgerOn): Promise<ConnectionPorts> {
  if (isOpened(ledger)) {
    return ledger;
  }
  const { connection, close } = await ledgerConnectedOn(ledger);
  onTestFinished(close);
  return connection;
}

export async function openedOn(ledger: LedgerOn, tables: readonly Statement[] = []): Promise<HostDatabase> {
  if (isOpened(ledger)) {
    await hostTablesMadeOn(ledger, tables);
    return hostDatabaseOn(ledger);
  }
  const database = await hostDatabaseOpenedOn(ledger, tables);
  onTestFinished(database.close);
  return database;
}

export async function openedBesideItsLedger(settings: DatabaseSettings): Promise<HostBesideItsLedger> {
  const opened = await hostBesideItsLedgerOn(settings);
  onTestFinished(opened.database.close);
  return opened;
}

export function leaseOn(database: HostDatabase): Promise<Lease> {
  return Effect.runPromise(oneRowOf(LeaseRow, database.read(leasesRead)));
}

export async function leaseHoldersOn(database: HostDatabase): Promise<readonly string[]> {
  const leases = await Effect.runPromise(rowsOf(LeaseRow, database.read(leasesRead)));
  return leases.map(({ holder }) => holder);
}

/**
 * Every lease of the database made past, as time passing on the clock that judges them would make it: on PostgreSQL
 * that is the database's own clock, which no test can move.
 */
export async function leasesLapsed(database: HostDatabase): Promise<void> {
  await Effect.runPromise(database.write(statement`UPDATE workflow_leases SET expires_at = 0`));
}
