import { Client, Pool } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { executorOn, postgresqlPlanOf } from '../content/postgresql-content.ts';
import { postgresqlLayout } from '../layout/layout-dialects.ts';
import { definitionStreamsPlan } from '../postgresql-reads/index-checks.ts';
import { postgresqlRecordedStore } from '../postgresql-reads/postgresql-recorded.ts';
import { databaseStructureBehaviour } from '../structure/database-structure-behaviour.ts';
import {
  appendedFactsOnStoresBehaviour,
  definitionNamesBehaviour,
  appendsWithStatementsOnStoresBehaviour,
  measuredRiddenAppendsBehaviour,
  multiStreamAppendBehaviour,
  factScrubOnStoresBehaviour,
  earlierShapesBehaviour,
  keptSecretsBehaviour,
  receivedWebhooksBehaviour,
  knownFactsBehaviour,
  ledgerBehaviour,
  ledgerStepsBehaviour,
  ledgerLayoutFloor,
  logBehaviour,
  type LedgerEntry,
} from '../testing/index.ts';
import { postgresqlLayoutCarried } from './postgresql-layout.ts';
import {
  plainPoolsOn,
  postgresqlEventStore,
  postgresqlLedgerLayer,
  postgresqlLedgerOpened,
  postgresqlReceivedWebhooks,
  postgresqlSecretRows,
} from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const carriedOn: LedgerEntry['carriedOn'] = async (database, carrying) => {
  const pool = new Pool({ connectionString: database });
  try {
    await postgresqlLayoutCarried(pool, [], carrying);
  } finally {
    await pool.end();
  }
};

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

const statementPlanOf: LedgerEntry['statementPlanOf'] = async (database, statement) => {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    return await postgresqlPlanOf(client, statement);
  } finally {
    await client.end();
  }
};

const updatesCountingOf: LedgerEntry['updatesCountingOf'] = (table, column) => [
  'CREATE TABLE IF NOT EXISTS counted_updates (column_name TEXT NOT NULL)',
  `CREATE OR REPLACE FUNCTION counted_update() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN INSERT INTO counted_updates (column_name) VALUES (TG_ARGV[0]); RETURN NULL; END $$`,
  `CREATE TRIGGER counted_updates_of_${column} AFTER UPDATE OF ${column} ON ${table}
    FOR EACH ROW EXECUTE FUNCTION counted_update('${column}')`,
];

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

const theOrgInAPlan =
  "CASE WHEN (strpos(substr(stream_id, (strpos(stream_id, '/'::text) + 1)), '/'::text) > 0) THEN split_part(stream_id, '/'::text, 2) ELSE NULL::text END";

const throughTheTreeIndex = `Index Cond: ((${theOrgInAPlan} = ANY ('{acme}'::text[])) AND ((message_metadata ->> 'correlationId'::text) = ANY ('{r1}'::text[])))`;

const onPostgreSQL: LedgerEntry = {
  mostEventsInOneAppend: 64,
  afterClosing: 'Cannot use a pool after calling end on the pool',
  closedWhileWriting: 'Cannot use a pool after calling end on the pool',
  aDatabase,
  ledgerOn: (database, runOutcomes, projections = [], holders) =>
    postgresqlLedgerLayer({
      pools: plainPoolsOn(database),
      projections,
      ...(runOutcomes === undefined ? {} : { runOutcomes }),
      ...(holders === undefined ? {} : { holders }),
    }),
  streamLedgerOn: (database, kept) => postgresqlLedgerLayer({ pools: plainPoolsOn(database), ...kept }),
  ledgerOutsideOn: (database, holders, content) =>
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), holders, content }),
  ledgerRaisingOn: (database, appended) => postgresqlLedgerLayer({ pools: plainPoolsOn(database), appended }),
  storeOn: (database) => postgresqlEventStore({ pools: plainPoolsOn(database), reportLostConnection }),
  openedOn: (database) => postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection }),
  queried,
  executedOn,
  layout: postgresqlLayout,
  carriedOn,
  definitionStreamsIndexed,
  planOf,
  statementPlanOf,
  throughTheKindIndex: `Index Cond: (("substring"(stream_id, '^(?:[^/]*/){4}'::text) = ANY`,
  throughTheIdIndex: `Index Cond: ((${theOrgInAPlan} = 'acme'::text) AND (message_id = `,
  throughTheTreeIndex,
  throughTheExpiringIndex: 'recorded_content_heads_expiring',
  stepsOfAScanOrASort: ['Seq Scan', 'Sort'],
  throughTheUploadIndex: 'Index Scan using recorded_content_heads_by_upload',
  updatesCountingOf,
  outcomeTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^run_outcomes_[0-9]+$' ORDER BY relname",
  projectionTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^run_tallies_[0-9]+$' ORDER BY relname",
  projectionIndexes:
    "SELECT indexname AS name FROM pg_indexes WHERE indexname ~ '^run_tallies_[0-9]+_' AND indexname !~ '_pkey$' ORDER BY indexname",
  topicTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^topics_[0-9]+$' ORDER BY relname",
  labelledTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^label' ORDER BY relname COLLATE \"C\"",
};

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

describe.skipIf(skipped)(`The ledger on PostgreSQL${notice}`, () => {
  ledgerBehaviour(onPostgreSQL);
  logBehaviour(onPostgreSQL);
  appendedFactsOnStoresBehaviour(onPostgreSQL);
  factScrubOnStoresBehaviour(onPostgreSQL);
  appendsWithStatementsOnStoresBehaviour(onPostgreSQL);
  measuredRiddenAppendsBehaviour(onPostgreSQL);
  earlierShapesBehaviour(onPostgreSQL);
  databaseStructureBehaviour(onPostgreSQL);
  knownFactsBehaviour(onPostgreSQL);
  ledgerStepsBehaviour(onPostgreSQL);
  keptSecretsBehaviour({
    ...onPostgreSQL,
    secretRowsOn: (database) => postgresqlSecretRows({ pools: plainPoolsOn(database) }),
  });
  receivedWebhooksBehaviour({
    ...onPostgreSQL,
    receivedWebhooksOn: (database) => postgresqlReceivedWebhooks({ pools: plainPoolsOn(database) }),
  });
  multiStreamAppendBehaviour({
    ...onPostgreSQL,
    storeKeeping: (database, { projections = [], definitionNames }) =>
      postgresqlEventStore({
        pools: plainPoolsOn(database),
        reportLostConnection,
        projections,
        ...(definitionNames === undefined ? {} : { definitionNames }),
      }),
  });
  definitionNamesBehaviour({
    ...onPostgreSQL,
    storeKeepingNames: (database, definitionNames) =>
      postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection, definitionNames }).store,
  });
});

describe.skipIf(skipped)(`A ledger on PostgreSQL given a floor of its own${notice}`, () => {
  it('carries a database forward from that floor alone, and refuses one of the layout below it as older than its floor', async () => {
    const database = await aDatabase();
    await carriedOn(database, { kept: ledgerLayoutFloor, floor: ledgerLayoutFloor, steps: [] });
    const { store } = postgresqlLedgerOpened({
      pools: plainPoolsOn(database),
      reportLostConnection,
      floor: ledgerLayoutFloor + 1,
    });

    const refused = await store.migrate().catch((error: unknown) => error);
    await store.close();

    expect(refused).toMatchObject({
      _tag: 'ledger_layout_refused',
      found: ledgerLayoutFloor,
      floor: ledgerLayoutFloor + 1,
    });
  });
});

const ofTwoKeys = { org: 'acme', keys: ['playbook/acme/alpha/', 'definition/acme/triage/'] } as const;

const throughTheKeyIndex = `Index Cond: ("substring"(stream_id, '^(?:[^/]*/){3}'::text) = ANY`;

const throughTheKindIndex = `Index Cond: (("substring"(stream_id, '^(?:[^/]*/){4}'::text) = ANY`;

function timesIn(plan: string, step: string): number {
  return plan.split(step).length - 1;
}

describe.skipIf(skipped)(`The plans of the reads over keys on PostgreSQL${notice}`, () => {
  it("walk each key asked through the key's index, and the tree of a run through the org's index", async () => {
    const database = await aDatabase();
    const { store } = postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection });
    await store.migrate();
    await store.close();

    const everything = await planOf(database, (read) =>
      read.readRecordedOfKeys(ofTwoKeys, { kind: 'everything' }, { order: 'desc', limit: 5 }),
    );
    const runs = await planOf(database, (read) =>
      read.readRecordedOfKeys(ofTwoKeys, { kind: 'runs' }, { order: 'desc', limit: 5 }),
    );
    const tree = await planOf(database, (read) =>
      read.readRecordedOfKeys(ofTwoKeys, { kind: 'correlated', correlation: 'r1' }, { order: 'desc', limit: 5 }),
    );

    expect(timesIn(everything, throughTheKeyIndex)).toBe(2);
    expect(timesIn(runs, throughTheKindIndex)).toBe(2);
    expect(tree).toContain(throughTheTreeIndex);
  });
});
