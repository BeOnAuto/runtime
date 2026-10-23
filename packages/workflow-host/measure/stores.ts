import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { plainPoolsOn } from '@on.auto/ledger/postgresql';
import { Client } from 'pg';

import type { DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';

export interface MeasuredStore {
  readonly store: string;
  readonly aDatabase: () => Promise<DatabaseSettings>;
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
      const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-workflow-host-measure-'));
      directories.push(directory);
      return Promise.resolve({ store: 'sqlite', file: join(directory, 'ledger.db') });
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
      const name = `workflow_host_measure_${randomUUID().replaceAll('-', '')}`;
      await administered(server, `CREATE DATABASE ${name}`);
      names.push(name);
      const database = new URL(server);
      database.pathname = `/${name}`;
      return { store: 'postgresql', pools: plainPoolsOn(database.href) };
    },
    removeAll: async () => {
      await Promise.all(names.splice(0).map((name) => administered(server, `DROP DATABASE ${name} WITH (FORCE)`)));
    },
  };
}

export function measuredStores(postgresqlServer: string): readonly MeasuredStore[] {
  return postgresqlServer === '' ? [onSQLite()] : [onSQLite(), onPostgreSQL(postgresqlServer)];
}
