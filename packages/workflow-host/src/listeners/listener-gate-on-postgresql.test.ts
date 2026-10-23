import { randomUUID } from 'node:crypto';

import { statement, textOnPostgreSQL } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { runGateOf } from '../follower/run-gate.ts';
import { onPostgreSQLAt, openedOn } from '../testing/host-files.ts';
import { insertedListener } from './listener-rows.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const playbookKey = 'playbook/acme/alpha/';

const runKey = 'acme/alpha/r-1';

const stream = `${playbookKey}run-logs/r-1`;

type RecordedEvent = Parameters<ReturnType<typeof runGateOf>['verdictOn']>[0];

const PassedRow = Schema.Struct({ listener: Schema.String, passed: WholeNumber });

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function aDatabase(): Promise<string> {
  const name = `workflow_host_${randomUUID().replaceAll('-', '')}`;
  const administration = await connected(server);
  await administration.query(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    const dropping = new Client({ connectionString: server });
    await dropping.connect();
    await dropping.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await dropping.end();
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const record: RecordedEvent = {
  id: 'record-2',
  cursor: 'cursor-2',
  causationId: null,
  correlationId: null,
  stream,
  version: 2,
  globalPosition: 2,
  type: 'input_applied',
  data: null,
  context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
  recordedAt: '2026-10-01T09:00:00.000Z',
};

interface Holding {
  readonly held: Readonly<Pick<Client, 'query'>>;
  readonly insertInto: string;
  readonly meanwhile: () => Promise<unknown>;
}

function holdingTheInsert(database: HostDatabase, { held, insertInto, meanwhile }: Holding): HostDatabase {
  return {
    ...database,
    write: (written) =>
      written.strings.join('').includes(`INSERT INTO ${insertInto}`)
        ? Effect.promise(async () => {
            await held.query('BEGIN');
            await held.query(textOnPostgreSQL(written), [...written.values]);
            await meanwhile();
            await held.query('COMMIT');
            return [];
          })
        : database.write(written),
  };
}

describe.skipIf(server === '')('a listener kept while the gate passes its run early, on PostgreSQL', () => {
  it('is marked passed though its insert was still open when the gate marked the run passed', async () => {
    const connectionString = await aDatabase();
    const database = await openedOn(onPostgreSQLAt(connectionString));
    const held = await connected(connectionString);
    await Effect.runPromise(
      database.write(
        statement`INSERT INTO workflow_runs (run_key, stream_id, dispatched_through) VALUES (${runKey}, ${stream}, ${0})`,
      ),
    );
    const passing = () => Effect.runPromise(runGateOf(database, playbookKey).verdictOn(record, true));

    await Effect.runPromise(
      insertedListener(holdingTheInsert(database, { held, insertInto: 'workflow_listeners', meanwhile: passing }), {
        runKey,
        listener: 'held',
        playbookKey,
        streamId: stream,
        armedBy: 2,
        filters: '[]',
        workflow: 'wait',
        version: 1,
        passed: false,
      }),
    );
    const listeners = await Effect.runPromise(
      rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners`)),
    );

    expect(listeners).toEqual([{ listener: 'held', passed: 1 }]);
  });
});

describe.skipIf(server === '')('the note of a run passed early while its dispatch catches up, on PostgreSQL', () => {
  it('is taken back when the dispatch reached the record while the note was still being written', async () => {
    const connectionString = await aDatabase();
    const database = await openedOn(onPostgreSQLAt(connectionString));
    const held = await connected(connectionString);
    await Effect.runPromise(
      database.write(
        statement`INSERT INTO workflow_runs (run_key, stream_id, dispatched_through) VALUES (${runKey}, ${stream}, ${0})`,
      ),
    );
    const catchingUp = () => Effect.runPromise(sqlWatermark(database).advance(runKey, 2));
    const holding = holdingTheInsert(database, { held, insertInto: 'workflow_passed_runs', meanwhile: catchingUp });

    const verdict = await Effect.runPromise(runGateOf(holding, playbookKey).verdictOn(record, true));
    const left = await Effect.runPromise(database.read(statement`SELECT run_key FROM workflow_passed_runs`));

    expect([verdict, left]).toEqual(['overdue', []]);
  });
});
