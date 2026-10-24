import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { executorOn } from '../content/postgresql-content.ts';
import { postgresqlLayout } from '../layout/layout-dialects.ts';
import { definitionStreamsPlan } from '../postgresql-reads/index-checks.ts';
import { postgresqlRecordedStore } from '../postgresql-reads/postgresql-recorded.ts';
import { keptSecretsBehaviour, ledgerBehaviour, type LedgerEntry } from '../testing/index.ts';
import {
  plainPoolsOn,
  postgresqlEventStore,
  postgresqlLedgerLayer,
  postgresqlLedgerOpened,
  postgresqlSecretRows,
} from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const executedOn: LedgerEntry['executedOn'] = async (database, work) => {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    return await work(executorOn(client));
  } finally {
    await client.end();
  }
};

async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function definitionStreamsIndexed(database: string): Promise<boolean> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const { explained, values, throughTheIndex } = definitionStreamsPlan;
    const plan = await client.query<Readonly<Record<string, unknown>>>(explained, values);
    return plan.rows.some((row) => String(row['QUERY PLAN']).includes(throughTheIndex));
  } finally {
    await client.end();
  }
}

const planOf: LedgerEntry['planOf'] = async (database, read) => {
  const asked: { readonly text: string; readonly values: readonly unknown[] }[] = [];
  await read(
    postgresqlRecordedStore((text, values) => {
      asked.push({ text, values });
      return Promise.resolve([]);
    }),
  );
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const plans = await Promise.all(
      asked.map(({ text, values }) => client.query<Readonly<Record<string, unknown>>>(`EXPLAIN ${text}`, [...values])),
    );
    const lines: string[] = [];
    for (const { rows } of plans) {
      lines.push(...rows.map((row) => String(row['QUERY PLAN'])));
    }
    return lines.join('\n');
  } finally {
    await client.end();
  }
};

async function aDatabase(): Promise<string> {
  const name = `ledger_${crypto.randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const lostConnections: Readonly<Error>[] = [];

function reportLostConnection(error: Readonly<Error>): void {
  lostConnections.push(error);
}

const onPostgreSQL: LedgerEntry = {
  mostEventsInOneAppend: 64,
  afterClosing: 'Cannot use a pool after calling end on the pool',
  closedWhileWriting: 'Cannot use a pool after calling end on the pool',
  aDatabase,
  ledgerOn: (database, runOutcomes, projections = []) =>
    postgresqlLedgerLayer({
      pools: plainPoolsOn(database),
      projections,
      ...(runOutcomes === undefined ? {} : { runOutcomes }),
    }),
  storeOn: (database) => postgresqlEventStore({ pools: plainPoolsOn(database), reportLostConnection }),
  openedOn: (database) => postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection }),
  queried,
  executedOn,
  layout: postgresqlLayout,
  definitionStreamsIndexed,
  planOf,
  throughTheKindIndex: `Index Cond: (("substring"(stream_id, '^(?:[^/]*/){4}'::text) = ANY`,
  throughTheIdIndex: 'Index Cond: (message_id = ',
  outcomeTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^run_outcomes_[0-9]+$' ORDER BY relname",
  projectionTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^run_tallies_[0-9]+$' ORDER BY relname",
  projectionIndexes:
    "SELECT indexname AS name FROM pg_indexes WHERE indexname ~ '^run_tallies_[0-9]+_' AND indexname !~ '_pkey$' ORDER BY indexname",
  topicTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^topics_[0-9]+$' ORDER BY relname",
};

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

describe.skipIf(skipped)(`The ledger on PostgreSQL${notice}`, () => {
  ledgerBehaviour(onPostgreSQL);
  keptSecretsBehaviour({
    ...onPostgreSQL,
    secretRowsOn: (database) => postgresqlSecretRows({ pools: plainPoolsOn(database) }),
  });
});
