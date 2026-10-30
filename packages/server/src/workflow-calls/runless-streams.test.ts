import { randomUUID } from 'node:crypto';

import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingCalls, startedRunOf } from '../testing/servers/workflow-calls.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `runless_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly environment: () => Promise<Readonly<Record<string, string>>>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, environment: () => Promise.resolve({}) },
  { store: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', environment: onADatabaseOfItsOwn },
];

const History = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      data: Schema.Struct({
        reference: Schema.optionalKey(Schema.String),
        run_id: Schema.optionalKey(Schema.String),
      }),
      metadata: Schema.Struct({ run_id: Schema.optionalKey(Schema.String) }),
    }),
  ),
});

const Listed = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String, type: Schema.String })),
});

const queued = '/do/0/wait';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function workflowsAndFunctionsIn(body: unknown): readonly string[] {
  return Schema.decodeUnknownSync(Listed)(body)
    .runs.map(({ run_id: id, type }) => (type === 'workflow' ? id : type))
    .toSorted();
}

async function holdingTheOnlyPermit(): Promise<string> {
  const holder = runIdIn((await startedRunOf(server, 'asking')).body);
  await until(
    () => Promise.resolve(server.modelCalls()),
    (calls) => calls > 0,
  );
  return holder;
}

async function childOfTheQueuedCall(parent: string): Promise<string> {
  const history = await until(
    () => server.call('GET', `${alpha}/runs/${parent}/history?limit=100`),
    ({ body }) => Schema.decodeUnknownSync(History)(body).events.some(({ data }) => data.reference === queued),
  );
  const waiting = Schema.decodeUnknownSync(History)(history.body).events.find(({ data }) => data.reference === queued);
  return String(waiting?.data.run_id);
}

async function cancelledFirst(child: string): Promise<void> {
  await until(
    () => server.call('GET', `${alpha}/events?type=run_cancel_requested&limit=100`),
    ({ body }) => Schema.decodeUnknownSync(History)(body).events.some(({ metadata }) => metadata.run_id === child),
  );
}

describe.each(stores)(
  'the stream of a run its caller cancelled before it started, on $store',
  ({ skipped, environment }) => {
    it.skipIf(skipped)('holds no run: the list leaves it out, and the run and its history are not found', async () => {
      server = await servingCalls([() => Effect.never], {
        ...(await environment()),
        WORKFLOW_NESTED_RUNS: '1',
      });
      const holder = await holdingTheOnlyPermit();
      const parent = runIdIn((await startedRunOf(server, 'waiting')).body);
      const child = await childOfTheQueuedCall(parent);

      await server.call('POST', `${alpha}/runs/${parent}/cancel`, { body: { reason: 'No longer needed' } });
      await settledRun(server, `${alpha}/runs/${parent}`);
      await cancelledFirst(child);
      const listed = await server.call('GET', `${alpha}/runs?limit=100`);
      const startedOnes = await server.call('GET', `${alpha}/runs?status=started&limit=100`);
      const run = await server.call('GET', `${alpha}/runs/${child}`);
      const history = await server.call('GET', `${alpha}/runs/${child}/history`);

      expect([listed.status, startedOnes.status, run.status, history.status]).toEqual([200, 200, 404, 404]);
      expect(workflowsAndFunctionsIn(listed.body)).toEqual([holder, parent, 'reasoning'].toSorted());
      expect(workflowsAndFunctionsIn(startedOnes.body)).toEqual([holder, 'reasoning'].toSorted());
    });
  },
);
