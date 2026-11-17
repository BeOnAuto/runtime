import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { LedgerServices } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import type { Layer } from 'effect';

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
  readonly unreadable: string;
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
      await at.rows('UPDATE emt_messages SET message_data = ? WHERE message_id = ?', [at.unreadable, id]);
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
    unreadable: '{not json',
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}
