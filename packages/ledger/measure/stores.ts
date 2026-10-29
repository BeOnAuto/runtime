import { DatabaseSync } from 'node:sqlite';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Function } from 'effect';
import { Client } from 'pg';

import type { AppendListeners, LedgerStore } from '../src/event-store.ts';
import { plainPoolsOn, postgresqlEventStore } from '../src/postgresql/postgresql-ledger.ts';
import { sqliteEventStore } from '../src/sqlite-event-store.ts';
import type { modestConnections } from '../src/sqlite3.ts';
import { temporaryDatabase } from '../src/testing/temporary-database.ts';

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

export interface MeasuredStore {
  readonly name: string;
  readonly statement: (text: string) => Promise<readonly Readonly<Record<string, unknown>>[]>;
  readonly opened: (listeners?: AppendListeners) => Promise<LedgerStore>;
  readonly dropped: () => Promise<void>;
}

async function openedOf(open: () => LedgerStore): Promise<LedgerStore> {
  const store = open();
  await store.migrate();
  return store;
}

export function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function median(values: readonly number[]): number {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;
}

export async function timed(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

export function inTurn<A>(items: readonly A[], each: (item: A) => Promise<unknown>): Promise<void> {
  return items.reduce<Promise<void>>(async (done, item) => {
    await done;
    await each(item);
  }, Promise.resolve());
}

export interface MeasuredOn {
  readonly sqliteConnections?: typeof modestConnections;
}

async function sqliteStore({ sqliteConnections }: MeasuredOn): Promise<MeasuredStore> {
  const { fileName, remove } = temporaryDatabase();
  const open = (listeners: AppendListeners = {}): LedgerStore =>
    sqliteEventStore(
      () => ({
        driver: sqlite3EventStoreDriver,
        fileName,
        ...(sqliteConnections === undefined ? {} : { connectionOptions: sqliteConnections }),
      }),
      {},
      listeners,
    );
  await (await openedOf(open)).close();
  return {
    name: 'SQLite',
    statement: (text) => {
      const database = new DatabaseSync(fileName);
      try {
        return Promise.resolve(database.prepare(text).all());
      } finally {
        database.close();
      }
    },
    opened: (listeners) => openedOf(() => open(listeners)),
    dropped: () => {
      remove();
      return Promise.resolve();
    },
  };
}

async function postgresqlStore(): Promise<MeasuredStore> {
  const administration = new Client({ connectionString: postgresqlServer });
  await administration.connect();
  const name = `ledger_measure_${Date.now()}`;
  await administration.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresqlServer);
  url.pathname = `/${name}`;
  const open = (listeners: AppendListeners = {}): LedgerStore =>
    postgresqlEventStore({ pools: plainPoolsOn(url.href), reportLostConnection: Function.constVoid, ...listeners });
  await (await openedOf(open)).close();
  const client = new Client({ connectionString: url.href });
  await client.connect();
  return {
    name: 'PostgreSQL',
    statement: async (text) => (await client.query<Readonly<Record<string, unknown>>>(text)).rows,
    opened: (listeners) => openedOf(() => open(listeners)),
    dropped: async () => {
      await client.end();
      await administration.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await administration.end();
    },
  };
}

export async function measuredOnEachStore(
  measure: (store: MeasuredStore) => Promise<void>,
  on: MeasuredOn = {},
): Promise<void> {
  const sqlite = await sqliteStore(on);
  await measure(sqlite);
  await sqlite.dropped();
  if (postgresqlServer !== '') {
    const postgresql = await postgresqlStore();
    await measure(postgresql);
    await postgresql.dropped();
  }
}
