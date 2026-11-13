import { statement } from '@on.auto/ledger';
import { contentHoldersOf } from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { RunLogRecordSchema, mostInlineHeldValueBytes, stateFormatKeepingPayloads } from '@on.auto/workflow-engine';
import { Context, Effect, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, onPostgreSQLAt, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';

const run = runAt(crypto.randomUUID());

const runLog = `run-logs/${run.runId}`;

const large = 'x'.repeat(mostInlineHeldValueBytes + 1);

const holding = workflow(`
do:
  - hold: { set: '\${ ({ text: "x".repeat(${mostInlineHeldValueBytes + 1}) }) }' }
  - pause: { wait: PT1H }
`);

const holders = contentHoldersOf([RunLogRecordSchema]);

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  server === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

type DatabaseSettings = Parameters<typeof openedOn>[0];

async function administered(statementText: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statementText);
  } finally {
    await client.end();
  }
}

async function aPostgreSQLDatabase(): Promise<DatabaseSettings> {
  const name = `workflow_host_${crypto.randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return onPostgreSQLAt(database.href);
}

const LogRows = Schema.Array(Schema.Struct({ data: Schema.String }));

const HeldRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, held: Schema.Union([Schema.Finite, Schema.FiniteFromString]) }),
);

async function runLogOn(settings: DatabaseSettings) {
  const database = await openedOn(settings);
  const rows = await Effect.runPromise(
    database.read(
      statement`SELECT CAST(message_data AS TEXT) AS data FROM emt_messages WHERE stream_id LIKE ${`%${runLog}`}`,
    ),
  );
  return Schema.decodeUnknownSync(LogRows)(rows).map(({ data }) => data);
}

async function heldOn(settings: DatabaseSettings) {
  const database = await openedOn(settings);
  const rows = await Effect.runPromise(database.read(statement`SELECT stream, held FROM content_references_1`));
  return Schema.decodeUnknownSync(HeldRows)(rows).filter(({ stream }) => stream === runLog);
}

async function startedKeeping(settings: DatabaseSettings): Promise<void> {
  const hosted = await hostedOn(settings, { context: Context.make(PayloadOffloading, true) });
  await Effect.runPromise(hosted.host.start(run, startOf(holding)));
}

describe('the engine the host composes where payloads are kept outside', () => {
  it('keeps a value past the threshold outside its log, writing format 12, and the ledger holds it for the log in the append', async () => {
    const settings = { store: 'sqlite', file: aSQLiteFile(), holders } as const;
    await startedKeeping(settings);

    const log = await runLogOn(settings);

    expect(log.map((data) => data.includes(`"format":${stateFormatKeepingPayloads}`))).toEqual([true]);
    expect(log.join('')).not.toContain(large);
    expect(await heldOn(settings)).toEqual([{ stream: runLog, held: 1 }]);
  });

  it.skipIf(server === '')(`keeps it outside and holds it the same way on PostgreSQL${notice}`, async () => {
    const settings = { ...(await aPostgreSQLDatabase()), holders };
    await startedKeeping(settings);

    const log = await runLogOn(settings);

    expect(log.join('')).not.toContain(large);
    expect(await heldOn(settings)).toEqual([{ stream: runLog, held: 1 }]);
  });
});
