import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryDatabase } from '../testing/temporary-database.ts';

const filledHeap = fileURLToPath(new URL('../../filled-heap.ts', import.meta.url));

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  server === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const mebibyte = 1024 * 1024;

const mostBytesFilledAtOnce = 2 * mebibyte;

const facts = 256;

const factBytes = 64 * 1024;

const KeptRows = Schema.Array(Schema.Struct({ key: Schema.String, row: Schema.Record(Schema.String, Schema.Unknown) }));

const Filled = Schema.fromJsonString(
  Schema.Struct({
    history: Schema.Number,
    mostHeld: Schema.Number,
    mostLoaded: Schema.Number,
    loaded: Schema.Number,
    kept: KeptRows,
    filled: KeptRows,
  }),
);

async function filledIn(filledInSettings: object): Promise<typeof Filled.Type> {
  const child = spawnForTheTest(
    process.execPath,
    [
      '--expose-gc',
      filledHeap,
      JSON.stringify(filledInSettings),
      String(facts),
      String(factBytes),
      String(mostBytesFilledAtOnce),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const said = { text: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    said.text += chunk;
  });
  await once(child, 'exit');
  return Schema.decodeUnknownSync(Filled)(said.text.trim());
}

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aPostgreSQLDatabase(): Promise<string> {
  const name = `ledger_${crypto.randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  onTestFinished(() => administered(`DROP DATABASE ${name} WITH (FORCE)`));
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

function aSQLiteFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly settings: () => Promise<object>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, settings: () => Promise.resolve({ store: 'sqlite', file: aSQLiteFile() }) },
  {
    store: `PostgreSQL${notice}`,
    skipped: server === '',
    settings: async () => ({ store: 'postgresql', connectionString: await aPostgreSQLDatabase() }),
  },
];

describe.each(stores)(
  'the fill of a projection keyed by its mapping, over a history eight times the most bytes it fills at once, on $store',
  ({ skipped, settings }) => {
    it.skipIf(skipped)(
      'holds the facts of one read at a time, and folds every fact into the row the appends kept',
      async () => {
        const filled = await filledIn(await settings());

        expect(filled.history).toBeGreaterThanOrEqual(8 * mostBytesFilledAtOnce);
        expect(filled.mostLoaded).toBeLessThanOrEqual(mostBytesFilledAtOnce);
        expect(filled.loaded).toBeGreaterThanOrEqual(filled.history);
        expect(filled.mostHeld).toBeLessThan(2 * mostBytesFilledAtOnce);
        expect(filled.kept).toMatchObject([{ key: 'autumn', row: { note: String(facts - 1) } }]);
        expect(filled.filled).toEqual(filled.kept);
      },
    );
  },
);
