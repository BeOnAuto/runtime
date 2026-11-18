import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { catchUpReadsBehaviour } from '../projection-catch-up/catch-up-reads-behaviour.ts';
import { sqliteCatchUp } from '../projection-catch-up/sqlite-catch-up.ts';
import { executedOn, statementPlanOf } from '../recorded/sqlite-checks.ts';
import { ledgerLayer } from '../sqlite.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { keyedFillBehaviour, type FillEntry } from './keyed-fill-behaviour.ts';
import { sqliteProjectionsOf } from './sqlite-projections.ts';

function aDatabase(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return Promise.resolve(fileName);
}

const filledHeap = fileURLToPath(new URL('../../filled-heap.ts', import.meta.url));

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { notice, anEmptyDatabase: aPostgreSQLDatabase } = postgresqlDatabasesOn(server);

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

describe('The window and the facts of a page of the catch-up on SQLite', () => {
  it('are read in the order of the store, through its key, from the position after the checkpoint, never a pass over every fact', async () => {
    const fileName = await aDatabase();
    await (await openLedgerWith(ledgerLayer({ fileName }))).dispose();

    const plans = await Promise.all([
      statementPlanOf(fileName, sqliteCatchUp.window({ after: '41', through: '900', count: 4096 })),
      statementPlanOf(fileName, sqliteCatchUp.window({ after: '41', through: undefined, count: 4096 })),
      statementPlanOf(fileName, sqliteCatchUp.factsAt(['42', '57'])),
    ]);

    expect(plans.map((plan) => /SEARCH emt_messages USING INTEGER PRIMARY KEY \(rowid[>=]/u.test(plan))).toEqual([
      true,
      true,
      true,
    ]);
    expect(plans.join(' ')).not.toMatch(/SCAN emt_messages|TEMP B-TREE/u);
  });
});

const onSQLite: FillEntry = {
  aDatabase,
  executedOn,
  ledgerOn: (fileName, { projections, holders }) => ledgerLayer({ fileName, projections, holders }),
  projectionsOf: sqliteProjectionsOf,
};

describe('The fills of a ledger on SQLite', () => {
  keyedFillBehaviour(onSQLite);
  catchUpReadsBehaviour(onSQLite);
});

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
