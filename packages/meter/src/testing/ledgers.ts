import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { LedgerServices } from '@on.auto/ledger';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { Layer } from 'effect';
import { Client } from 'pg';

type Row = Readonly<Record<string, unknown>>;

function parsed(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

export interface LedgerAt {
  readonly name: string;
  readonly layer: () => Layer.Layer<LedgerServices>;
  readonly rows: (statement: string, values?: readonly (string | number)[]) => Promise<readonly Row[]>;
  readonly dataOf: (stored: unknown) => unknown;
  readonly stored: (data: unknown) => string;
  readonly remove: () => Promise<void>;
}

export interface Tampering {
  readonly idsOf: (stream: string) => Promise<readonly string[]>;
  readonly edited: (id: string, change: (data: Readonly<Record<string, unknown>>) => unknown) => Promise<void>;
  readonly deleted: (id: string) => Promise<void>;
  readonly streamDeleted: (stream: string) => Promise<void>;
  readonly garbled: (id: string) => Promise<void>;
  readonly lastPosition: () => Promise<number>;
  readonly restoredTo: (position: number) => Promise<void>;
}

export function tamperingOn(at: LedgerAt): Tampering {
  return {
    idsOf: async (stream) =>
      (await at.rows('SELECT message_id FROM emt_messages WHERE stream_id = ? ORDER BY stream_position', [stream])).map(
        (row) => String(row['message_id']),
      ),
    edited: async (id, change) => {
      const [row] = await at.rows('SELECT message_data FROM emt_messages WHERE message_id = ?', [id]);
      const data = new Object(at.dataOf(row?.['message_data']));
      await at.rows('UPDATE emt_messages SET message_data = ? WHERE message_id = ?', [
        at.stored(change(Object.fromEntries(Object.entries(data)))),
        id,
      ]);
    },
    deleted: async (id) => {
      await at.rows('DELETE FROM emt_messages WHERE message_id = ?', [id]);
    },
    garbled: async (id) => {
      await at.rows("UPDATE emt_messages SET message_data = '{not json' WHERE message_id = ?", [id]);
    },
    lastPosition: async () => {
      const [row] = await at.rows('SELECT MAX(global_position) AS last FROM emt_messages');
      return Number(row?.['last']);
    },
    restoredTo: async (position) => {
      await at.rows('DELETE FROM emt_messages WHERE global_position > ?', [position]);
      await at.rows(
        'UPDATE emt_streams SET stream_position = (SELECT COALESCE(MAX(m.stream_position), 0) FROM emt_messages m WHERE m.stream_id = emt_streams.stream_id)',
      );
      await at.rows('DELETE FROM emt_streams WHERE stream_position = 0');
    },
    streamDeleted: async (stream) => {
      await at.rows('DELETE FROM emt_messages WHERE stream_id = ?', [stream]);
      await at.rows('DELETE FROM emt_streams WHERE stream_id = ?', [stream]);
    },
  };
}

export function sqliteLedger(): LedgerAt {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-meter-'));
  const fileName = join(directory, 'ledger.db');
  return {
    name: 'SQLite',
    layer: () => ledgerLayer({ fileName }),
    rows: (statement, values = []) => {
      const database = new DatabaseSync(fileName);
      try {
        const prepared = database.prepare(statement);
        if (statement.trimStart().startsWith('SELECT')) return Promise.resolve(prepared.all(...values));
        const { changes } = prepared.run(...values);
        return Promise.resolve([{ changes: Number(changes) }]);
      } finally {
        database.close();
      }
    },
    dataOf: (stored) => parsed(String(stored)),
    stored: (data) => JSON.stringify(data),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
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

export async function postgresqlLedger(server: string): Promise<LedgerAt> {
  const name = `meter_${randomUUID().replaceAll('-', '')}`;
  await administered(server, `CREATE DATABASE ${name}`);
  const database = new URL(server);
  database.pathname = `/${name}`;
  return {
    name: 'PostgreSQL',
    layer: () => postgresqlLedgerLayer({ pools: plainPoolsOn(database.href) }),
    rows: async (statement, values = []) => {
      const client = new Client({ connectionString: database.href });
      await client.connect();
      try {
        let place = 0;
        const numbered = statement.replaceAll('?', () => {
          place += 1;
          return `$${place}`;
        });
        return (await client.query<Row>(numbered, [...values])).rows;
      } finally {
        await client.end();
      }
    },
    dataOf: (stored) => parsed(String(Reflect.get(new Object(stored), 'json'))),
    stored: (data) => JSON.stringify({ json: JSON.stringify(data) }),
    remove: () => administered(server, `DROP DATABASE ${name} WITH (FORCE)`),
  };
}
