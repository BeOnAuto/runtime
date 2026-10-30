import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { Ledger } from '@on.auto/operations';
import type { DatabaseSettings } from '@on.auto/workflow-host/testing';
import type { Layer } from 'effect';
import { Client } from 'pg';

interface MeasuredDatabase {
  readonly settings: DatabaseSettings;
  readonly ledger: Layer.Layer<Ledger>;
}

export interface MeasuredStore {
  readonly store: string;
  readonly aDatabase: () => Promise<MeasuredDatabase>;
  readonly removeAll: () => Promise<void>;
}

async function administered(server: string, statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

function onSQLite(): MeasuredStore {
  const directories: string[] = [];
  return {
    store: 'SQLite',
    aDatabase: () => {
      const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-prediction-measure-'));
      directories.push(directory);
      const file = join(directory, 'ledger.db');
      return Promise.resolve({ settings: { store: 'sqlite', file }, ledger: ledgerLayer({ fileName: file }) });
    },
    removeAll: () => {
      for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
      }
      return Promise.resolve();
    },
  };
}

function onPostgreSQL(server: string): MeasuredStore {
  const names: string[] = [];
  return {
    store: 'PostgreSQL',
    aDatabase: async () => {
      const name = `prediction_measure_${randomUUID().replaceAll('-', '')}`;
      await administered(server, `CREATE DATABASE ${name}`);
      names.push(name);
      const database = new URL(server);
      database.pathname = `/${name}`;
      const pools = plainPoolsOn(database.href);
      return {
        settings: { store: 'postgresql', pools },
        ledger: postgresqlLedgerLayer({ pools }),
      };
    },
    removeAll: async () => {
      await Promise.all(names.splice(0).map((name) => administered(server, `DROP DATABASE ${name} WITH (FORCE)`)));
    },
  };
}

export function measuredStores(postgresqlServer: string): readonly MeasuredStore[] {
  return postgresqlServer === '' ? [onSQLite()] : [onSQLite(), onPostgreSQL(postgresqlServer)];
}
