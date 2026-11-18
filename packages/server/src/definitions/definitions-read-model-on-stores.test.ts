import { definitionNamesOf } from '@on.auto/definitions/identity';
import { aGeneratedHistory, definitionsReadModelOf } from '@on.auto/definitions/testing';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import {
  keepsChildRows,
  Ledger,
  projectedTableOf,
  type KeptProjection,
  type ProjectedKeyedRow,
  type ProjectedRow,
  type ProjectedValue,
} from '@on.auto/operations';
import { Effect, ManagedRuntime, Schema, type Layer } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { catalogOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

const readModel = definitionsReadModelOf(types);

const alpha = { org: 'acme', playbook: 'alpha' };

const tables = ['definitions', 'definition_versions', 'definition_references'];

const definitionNames = definitionNamesOf(types, () => Number.POSITIVE_INFINITY);

interface Kept {
  readonly definitionNames: typeof definitionNames;
  readonly projections: readonly KeptProjection[];
  readonly mostBytesFilledAtOnce?: number;
}

type Opening = (kept: Kept) => Layer.Layer<Ledger>;

interface Place {
  readonly ledgerOn: Opening;
  readonly tablesNamed: () => Promise<readonly string[]>;
}

function opened(layer: Layer.Layer<Ledger>): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Effect.service(Ledger));
}

function onSQLite(): Promise<Place> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    ledgerOn: (kept: Kept) => ledgerLayer({ fileName: ledger.fileName, ...kept }),
    tablesNamed: async () =>
      (await catalogOfTheLedgerIn(ledger.fileName))
        .filter(({ sql }) => sql.startsWith('CREATE TABLE'))
        .map(({ name }) => name),
  });
}

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

async function rowsQueried(connectionString: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows }: { readonly rows: readonly unknown[] } = await client.query(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function administer(connectionString: string, statement: string): Promise<void> {
  await rowsQueried(connectionString, statement);
}

async function onPostgreSQL(): Promise<Place> {
  const name = `definitions_${crypto.randomUUID().replaceAll('-', '')}`;
  await administer(postgresql, `CREATE DATABASE ${name}`);
  onTestFinished(() => administer(postgresql, `DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return {
    ledgerOn: (kept: Kept) => postgresqlLedgerLayer({ pools: plainPoolsOn(url.href), ...kept }),
    tablesNamed: async () =>
      decodeNames(
        await rowsQueried(
          url.href,
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
        ),
      ).map(({ name: table }) => table),
  };
}

function rowsOf(ledger: Ledger['Service']) {
  return Effect.runPromise(
    Effect.forEach(tables, (table) =>
      ledger.readProjectedRows(table, alpha, { where: [], orderBy: [], order: 'asc', limit: 1000 }),
    ),
  );
}

async function foldedInline(aPlace: () => Promise<Place>, seed: number) {
  const { ledgerOn } = await aPlace();
  const ledger = await opened(ledgerOn({ definitionNames, projections: readModel }));
  await aGeneratedHistory(ledger, seed, types);
  return rowsOf(ledger);
}

async function filled(aPlace: () => Promise<Place>, seed: number, mostBytesFilledAtOnce?: number) {
  const { ledgerOn } = await aPlace();
  await aGeneratedHistory(await opened(ledgerOn({ definitionNames, projections: [] })), seed, types);
  const reopened = ledgerOn({
    definitionNames,
    projections: readModel,
    ...(mostBytesFilledAtOnce === undefined ? {} : { mostBytesFilledAtOnce }),
  });
  return rowsOf(await opened(reopened));
}

const theNewColumn = 'contributes';

function withoutTheNewColumn(row: ProjectedRow | undefined): ProjectedRow | undefined {
  return row === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(row).filter(([name]: readonly [string, ProjectedValue]) => name !== theNewColumn),
      );
}

function asTheVersionBefore(table: KeptProjection, version: number): KeptProjection {
  const columns = table.columns.filter(({ name }) => name !== theNewColumn);
  return keepsChildRows(table)
    ? { ...table, version, columns }
    : { ...table, version, columns, rowAfter: (row, message) => withoutTheNewColumn(table.rowAfter(row, message)) };
}

function theVersionBefore(projections: readonly KeptProjection[]): readonly KeptProjection[] {
  return projections.map((table) => asTheVersionBefore(table, table.version - 1));
}

function tablesOfTheVersion(projections: readonly KeptProjection[]): readonly string[] {
  return projections.map((table) => projectedTableOf(table)).toSorted();
}

const namesOfTheReadModel = new Set(readModel.map(({ name }) => name));

async function tablesOfTheReadModelIn({ tablesNamed }: Place): Promise<readonly string[]> {
  return (await tablesNamed()).filter((table) => namesOfTheReadModel.has(table.replace(/_\d+$/u, ''))).toSorted();
}

function contributionsIn([definitions = []]: readonly (readonly ProjectedKeyedRow[])[]): readonly unknown[] {
  return definitions.flatMap(({ row }) => ((row[theNewColumn] ?? null) === null ? [] : [row[theNewColumn]]));
}

async function rebuiltOverTheVersionBefore(aPlace: () => Promise<Place>, seed: number) {
  const place = await aPlace();
  const before = await opened(place.ledgerOn({ definitionNames, projections: theVersionBefore(readModel) }));
  await aGeneratedHistory(before, seed, types);
  const keptBefore = { rows: await rowsOf(before), tables: await tablesOfTheReadModelIn(place) };
  const rebuilt = await rowsOf(await opened(place.ledgerOn({ definitionNames, projections: readModel })));
  return { keptBefore, rebuilt, tables: await tablesOfTheReadModelIn(place) };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aPlace: () => Promise<Place>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aPlace: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aPlace: onPostgreSQL },
];

describe.each(stores)('the read model of the current definitions on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped).each([1, 2, 3])(
    'holds the same rows folded inline, filled from its facts as the store opens, and filled one fact a page, history %i',
    async (seed) => {
      const inline = await foldedInline(aPlace, seed);

      expect(inline.flat().length).toBeGreaterThan(10);
      expect([await filled(aPlace, seed), await filled(aPlace, seed, 1)]).toEqual([inline, inline]);
    },
  );

  it.skipIf(skipped).each([1, 2, 3])(
    'is built again from its facts where a store held the rows of its version before, whose tables it drops, history %i',
    async (seed) => {
      const { keptBefore, rebuilt, tables: tablesAfter } = await rebuiltOverTheVersionBefore(aPlace, seed);

      expect(keptBefore.rows.flat().length).toBeGreaterThan(10);
      expect([keptBefore.tables, contributionsIn(keptBefore.rows)]).toEqual([
        tablesOfTheVersion(theVersionBefore(readModel)),
        [],
      ]);
      expect(contributionsIn(rebuilt).length).toBeGreaterThan(0);
      expect(rebuilt).toEqual(await foldedInline(aPlace, seed));
      expect(tablesAfter).toEqual(tablesOfTheVersion(readModel));
    },
  );
});
