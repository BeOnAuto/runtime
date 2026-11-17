import { statement } from '@on.auto/ledger';
import { contentHoldersOf } from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { RunLogRecordSchema, mostInlineHeldValueBytes, stateFormatKeepingPayloads } from '@on.auto/workflow-engine';
import { Context, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, onPostgreSQLAt, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';

const run = runAt(crypto.randomUUID());

const runLog = `run-logs/${run.runId}`;

const large = 'x'.repeat(mostInlineHeldValueBytes + 1);

const holding = workflow(`
do:
  - hold: { set: '\${ ({ text: "x".repeat(${mostInlineHeldValueBytes + 1}) }) }' }
  - pause: { wait: PT1H }
`);

const holders = contentHoldersOf([RunLogRecordSchema]);

type DatabaseSettings = Parameters<typeof openedOn>[0];

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
  const rows = await Effect.runPromise(database.read(statement`SELECT stream, held FROM content_references_2`));
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
});

describeOnPostgreSQL('the engine the host composes where payloads are kept outside', (aDatabase) => {
  it('keeps it outside and holds it the same way', async () => {
    const settings = { ...onPostgreSQLAt(await aDatabase()), holders };
    await startedKeeping(settings);

    const log = await runLogOn(settings);

    expect(log.join('')).not.toContain(large);
    expect(await heldOn(settings)).toEqual([{ stream: runLog, held: 1 }]);
  });
});
