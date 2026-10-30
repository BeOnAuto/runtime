import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { conversations, openRequests } from '@on.auto/interaction';
import { projectedTableOf } from '@on.auto/operations';
import { Client } from 'pg';

interface LedgerUse {
  readonly environment: Readonly<Record<string, string>>;
  readonly expireEveryRequestAt: (at: number) => Promise<number>;
  readonly readEveryConversationAt: (at: number) => Promise<number>;
}

export interface MeasuredLedger {
  readonly store: string;
  readonly aLedger: () => Promise<LedgerUse>;
  readonly removeAll: () => Promise<void>;
}

const expiring = `UPDATE ${projectedTableOf(openRequests)} SET expires_at = $1, ending_due_at = $1`;

const reading = `UPDATE ${projectedTableOf(conversations)} SET next_read_at = $1, due_at = $1, reads = 1`;

function sqliteRun(file: string, statement: string, at: number): Promise<number> {
  const database = new DatabaseSync(file);
  const { changes } = database.prepare(statement.replaceAll('$1', '?')).run(at, at);
  database.close();
  return Promise.resolve(Number(changes));
}

async function administered(server: string, statement: string, values: readonly number[] = []): Promise<number> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    return (await client.query(statement, [...values])).rowCount ?? 0;
  } finally {
    await client.end();
  }
}

function onSQLite(): MeasuredLedger {
  const directories: string[] = [];
  return {
    store: 'SQLite',
    aLedger: () => {
      const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-server-measure-'));
      directories.push(directory);
      const file = join(directory, 'ledger.db');
      return Promise.resolve({
        environment: { LEDGER_FILE: file },
        expireEveryRequestAt: (at) => sqliteRun(file, expiring, at),
        readEveryConversationAt: (at) => sqliteRun(file, reading, at),
      });
    },
    removeAll: () => {
      for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
      }
      return Promise.resolve();
    },
  };
}

function onPostgreSQL(server: string): MeasuredLedger {
  const names: string[] = [];
  return {
    store: 'PostgreSQL',
    aLedger: async () => {
      const name = `server_measure_${randomUUID().replaceAll('-', '')}`;
      await administered(server, `CREATE DATABASE ${name}`);
      names.push(name);
      const database = new URL(server);
      database.pathname = `/${name}`;
      return {
        environment: { DATABASE_URL: database.href },
        expireEveryRequestAt: (at) => administered(database.href, expiring, [at]),
        readEveryConversationAt: (at) => administered(database.href, reading, [at]),
      };
    },
    removeAll: async () => {
      await Promise.all(names.splice(0).map((name) => administered(server, `DROP DATABASE ${name} WITH (FORCE)`)));
    },
  };
}

export function measuredLedgers(postgresqlServer: string): readonly MeasuredLedger[] {
  return postgresqlServer === '' ? [onSQLite()] : [onSQLite(), onPostgreSQL(postgresqlServer)];
}
