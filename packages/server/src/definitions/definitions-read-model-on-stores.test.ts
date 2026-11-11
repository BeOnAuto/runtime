import { aGeneratedHistory, definitionsReadModelOf } from '@on.auto/definitions/testing';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger, type StreamProjection } from '@on.auto/operations';
import { Effect, ManagedRuntime, type Layer } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

const readModel = definitionsReadModelOf(types);

const alpha = { org: 'acme', playbook: 'alpha' };

const tables = ['definitions', 'definition_versions', 'definition_references'];

interface Kept {
  readonly streamProjections: readonly StreamProjection[];
  readonly mostBytesFilledAtOnce?: number;
}

type Opening = (kept: Kept) => Layer.Layer<Ledger>;

function opened(layer: Layer.Layer<Ledger>): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Effect.service(Ledger));
}

function onSQLite(): Promise<Opening> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve((kept: Kept) => ledgerLayer({ fileName: ledger.fileName, ...kept }));
}

async function administer(connectionString: string, statement: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onPostgreSQL(): Promise<Opening> {
  const name = `definitions_${crypto.randomUUID().replaceAll('-', '')}`;
  await administer(postgresql, `CREATE DATABASE ${name}`);
  onTestFinished(() => administer(postgresql, `DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return (kept: Kept) => postgresqlLedgerLayer({ pools: plainPoolsOn(url.href), ...kept });
}

function rowsOf(ledger: Ledger['Service']) {
  return Effect.runPromise(
    Effect.forEach(tables, (table) =>
      ledger.readProjectedRows(table, alpha, { where: [], orderBy: [], order: 'asc', limit: 1000 }),
    ),
  );
}

async function foldedInline(aPlace: () => Promise<Opening>, seed: number) {
  const ledgerOn = await aPlace();
  const ledger = await opened(ledgerOn({ streamProjections: [readModel] }));
  await aGeneratedHistory(ledger, seed, types);
  return rowsOf(ledger);
}

async function caughtUp(aPlace: () => Promise<Opening>, seed: number, mostBytesFilledAtOnce?: number) {
  const ledgerOn = await aPlace();
  await aGeneratedHistory(await opened(ledgerOn({ streamProjections: [] })), seed, types);
  const reopened = ledgerOn({
    streamProjections: [readModel],
    ...(mostBytesFilledAtOnce === undefined ? {} : { mostBytesFilledAtOnce }),
  });
  return rowsOf(await opened(reopened));
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aPlace: () => Promise<Opening>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aPlace: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aPlace: onPostgreSQL },
];

describe.each(stores)('the read model of the current definitions on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped).each([1, 2, 3])(
    'holds the same rows folded inline, caught up from its facts, and caught up one fact a page, history %i',
    async (seed) => {
      const inline = await foldedInline(aPlace, seed);

      expect(inline.flat().length).toBeGreaterThan(10);
      expect([await caughtUp(aPlace, seed), await caughtUp(aPlace, seed, 1)]).toEqual([inline, inline]);
    },
  );
});
