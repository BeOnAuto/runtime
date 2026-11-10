import { topicFacts, topicRows } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { executorOn } from '../content/postgresql-content.ts';
import type { StatementExecutor } from '../event-store.ts';
import { keyedFillBehaviour, type FillEntry } from '../projections/keyed-fill-behaviour.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const executedOn: FillEntry['executedOn'] = async (database, work) => {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    return await work(executorOn(client));
  } finally {
    await client.end();
  }
};

async function onTheServer(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `ledger_${crypto.randomUUID().replaceAll('-', '')}`;
  await onTheServer(`CREATE DATABASE ${name}`);
  onTestFinished(() => onTheServer(`DROP DATABASE ${name} WITH (FORCE)`));
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

describe.skipIf(skipped)(`The fills of a ledger on PostgreSQL${notice}`, () => {
  keyedFillBehaviour({
    aDatabase,
    executedOn,
    ledgerOn: (database, { projections = [], holders }) =>
      postgresqlLedgerLayer({
        pools: plainPoolsOn(database),
        projections,
        ...(holders === undefined ? {} : { holders }),
      }),
    projectionsOf: postgresqlProjectionsOf,
  });
});

const landedInsert = `INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind, message_data,
    message_metadata, message_schema_version, message_type, message_id, is_archived, transaction_id)
  SELECT 'playbook/acme/alpha/notes/landed', 1, partition, message_kind,
    jsonb_build_object('json', '{"topic":"autumn","note":"landed"}'), message_metadata, message_schema_version,
    'topic_noted', 'landed-1', FALSE, pg_current_xact_id()
  FROM emt_messages WHERE stream_id = 'playbook/acme/alpha/runs/r1'`;

const pointsOf = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ point: Schema.optionalKey(Schema.Unknown) })));

function committedOnTheListingOf(execute: StatementExecutor, point: string, commit: () => Promise<unknown>) {
  const committed = { once: false };
  const landing: StatementExecutor = {
    query: async (sql) => {
      const answer = await execute.query(sql);
      const names = pointsOf(answer.rows).some((row) => row.point === point);
      if (names && !committed.once) {
        committed.once = true;
        await commit();
      }
      return answer;
    },
    command: (sql) => execute.command(sql),
  };
  return landing;
}

async function connected(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

describe.skipIf(skipped)(`A fill on PostgreSQL that a fact lands in between a listing and its read${notice}`, () => {
  it('reads through the last fact it listed, so the fact that landed is read too and the last listed is not dropped', async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    onTestFinished(dispose);
    await Effect.runPromise(
      ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
        { type: 'topic_opened', data: { topic: 'autumn', at: 1000 } },
      ]),
    );
    const late = await connected(database);
    await late.query('BEGIN');
    await late.query(landedInsert);
    await Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/last', topicFacts, [
        { type: 'topic_noted', data: { topic: 'autumn', note: 'last' } },
      ]),
    );
    const reading = await connected(database);
    const { rows: lastPoints } = await reading.query<Readonly<{ point: string }>>(
      "SELECT transaction_id::text || '/' || global_position::text AS point FROM emt_messages WHERE stream_id = $1",
      ['playbook/acme/alpha/notes/last'],
    );
    const last = lastPoints.map((row) => row.point).join('');

    await executedOn(database, async (execute) => {
      const landing = committedOnTheListingOf(execute, last, () => late.query('COMMIT'));
      await postgresqlProjectionsOf({ projections: [topicRows] }).prepare(landing, (work) => work(landing));
    });
    const { rows } = await reading.query<Readonly<{ note: string }>>('SELECT note FROM topics_2');

    expect(rows).toEqual([{ note: 'last' }]);
  });
});
