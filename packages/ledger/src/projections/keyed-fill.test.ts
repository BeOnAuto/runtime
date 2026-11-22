import { runTallyRows } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { filledStoreOf, type FilledIn } from '../../filled-stores.ts';
import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import type { CatchUpState, EncodedEvent, LedgerStore } from '../event-store.ts';
import { at, began, r1, r2, r3, to } from '../multi-stream/multi-stream-cases.ts';
import { catchUpReadsBehaviour } from '../projection-catch-up/catch-up-reads-behaviour.ts';
import { sqliteCatchUp } from '../projection-catch-up/sqlite-catch-up.ts';
import { executedOn, queried, statementPlanOf } from '../recorded/sqlite-checks.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { ledgerLayer } from '../sqlite.ts';
import { fillMeasuredOn } from '../testing/measured-fill.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import type { KeptTables } from './kept-tables.ts';
import { keyedFillBehaviour, type FillEntry } from './keyed-fill-behaviour.ts';
import { sqliteProjectionsOf } from './sqlite-projections.ts';

function aDatabase(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return Promise.resolve(fileName);
}

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { notice, anEmptyDatabase: aPostgreSQLDatabase } = postgresqlDatabasesOn(server);

const sizes = { facts: 64, factBytes: 1024, mostBytesFilledAtOnce: 8 * 1024 };

const nothingMeasured = () => 0;

function aSQLiteFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly filledIn: () => Promise<FilledIn>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, filledIn: () => Promise.resolve({ store: 'sqlite', file: aSQLiteFile() }) },
  {
    store: `PostgreSQL${notice}`,
    skipped: server === '',
    filledIn: async () => ({ store: 'postgresql', connectionString: await aPostgreSQLDatabase() }),
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

const runNoted: EncodedEvent = { type: 'run_noted', data: {} };

const tallies = 'SELECT row_key, facts FROM run_tallies_2 ORDER BY row_key';

async function aStoreOn(fileName: string, kept: KeptTables): Promise<LedgerStore> {
  const store = sqliteEventStore(() => ({ driver: nodeSqliteEventStoreDriver, fileName }), kept);
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

async function slicesToTheEnd(store: LedgerStore): Promise<readonly CatchUpState[]> {
  const state = await store.catchUpSlice();
  return state === 'caught_up' ? [state] : [state, ...(await slicesToTheEnd(store))];
}

describe('The appends to a store on SQLite while its keyed table catches up a slice at a time', () => {
  it('leave the table as it was, one append and an append to several streams alike, and are in it once each when the catch-up ends, on a table that counts its facts', async () => {
    const fileName = await aDatabase();
    const inline = await aStoreOn(fileName, { projections: [runTallyRows] });
    await inline.append(r1, [began], at(0));
    await inline.append(r2, [began], at(0));
    await inline.append(r3, [began], at(0));
    await queried(fileName, 'DROP TABLE run_tallies_2');
    const store = await aStoreOn(fileName, {
      projections: [runTallyRows],
      mostBytesFilledAtOnce: 1,
      catchUpBudget: { pages: 1 },
    });

    await store.append(r1, [runNoted], at(1));
    await store.multiStreamAppend([to(r2, 1, runNoted), to(r3, 1, runNoted)]);
    const whileCatchingUp = await queried(fileName, tallies);
    const slices = await slicesToTheEnd(store);

    expect(whileCatchingUp).toEqual([{ row_key: 'r1', facts: 1 }]);
    expect(slices.at(-1)).toBe('caught_up');
    expect(await queried(fileName, tallies)).toEqual([
      { row_key: 'r1', facts: 2 },
      { row_key: 'r2', facts: 2 },
      { row_key: 'r3', facts: 2 },
    ]);
  });
});

describe.each(stores)(
  'the fill of a projection keyed by its mapping, over a history eight times the most bytes it fills at once, reading no more than those at a time, on $store',
  ({ skipped, filledIn }) => {
    it.skipIf(skipped)(
      'brings back no more than the most bytes it fills at once in any one read, and folds every fact into the row the appends kept',
      async () => {
        const { history, loads, kept, filled } = await fillMeasuredOn(
          filledStoreOf(await filledIn()),
          sizes,
          nothingMeasured,
        );

        expect(history).toBeGreaterThanOrEqual(8 * sizes.mostBytesFilledAtOnce);
        expect(Math.max(...loads)).toBeLessThanOrEqual(sizes.mostBytesFilledAtOnce);
        expect(loads.reduce((sum, load) => sum + load, 0)).toBeGreaterThanOrEqual(history);
        expect(kept).toMatchObject([{ key: 'autumn', row: { note: String(sizes.facts - 1) } }]);
        expect(filled).toEqual(kept);
      },
    );
  },
);
