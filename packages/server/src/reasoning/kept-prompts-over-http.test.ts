import { createHash, randomUUID } from 'node:crypto';

import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const reads = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Read: {{ input.text }}',
].join('\n');

const text = 't'.repeat(17_000);

const prompt = { instructions: 'Be brief.', message: `Read: ${text}`, truncated: false };

const promptText = JSON.stringify(prompt);

const keptPrompt = {
  prompt_sha256: createHash('sha256').update(promptText).digest('hex'),
  prompt_bytes: Buffer.byteLength(promptText, 'utf8'),
};

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
  const name = `kept_prompts_${randomUUID().replaceAll('-', '')}`;
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

const RecordSchema = Schema.Record(Schema.String, Schema.Json);

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ record: RecordSchema }));

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String, data: RecordSchema })),
  }),
);

const decodeEvent = Schema.decodeUnknownSync(Schema.Struct({ data: RecordSchema }));

function servingOver(
  environment: Readonly<Record<string, string>>,
  keptOutside: boolean,
  ledger?: TemporaryLedger,
): Promise<ReasoningServer> {
  return servingReasoning([answers(textResult('Read.'))], environment, noNetwork, {
    ...(keptOutside ? { keptOutside } : {}),
    ...(ledger === undefined ? {} : { ledger }),
  });
}

async function serving(environment: Readonly<Record<string, string>>, keptOutside: boolean): Promise<ReasoningServer> {
  const server = await servingOver(environment, keptOutside);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'reads', source: reads, diagram: 'none' },
  });
  return server;
}

async function ranAndReadBack(server: ReasoningServer) {
  const ran = await server.call('POST', `${alpha}/definitions/reasoning/reads/run`, {
    body: { input: { text }, run_id: runId },
  });
  const read = await server.call('GET', `${alpha}/runs/${runId}`);
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const ending = decodeEvents(history.body).events.find(({ type }) => type === 'run_succeeded');
  const whole = await server.call('GET', `${alpha}/events/${ending?.id ?? 'none'}`);
  return {
    answered: decodeRun(ran.body).record,
    read: decodeRun(read.body).record,
    onAPage: ending?.data,
    whole: decodeEvent(whole.body).data['record'],
  };
}

async function ranWhileKeeping(store: Readonly<Record<string, string>>, ledger: TemporaryLedger): Promise<void> {
  const keeping = await servingOver(store, true, ledger);
  try {
    await keeping.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await keeping.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'reads', source: reads, diagram: 'none' },
    });
    await keeping.call('POST', `${alpha}/definitions/reasoning/reads/run`, {
      body: { input: { text }, run_id: runId },
    });
  } finally {
    await keeping.stop();
  }
}

describe.each(stores)('a reasoning run whose prompt is past 16,384 bytes, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'keeps the prompt outside its ending where the server keeps large values outside, and answers and shows the run as a server that keeps it inline does',
    async () => {
      const keeping = await ranAndReadBack(await serving(await environment(), true));
      const inline = await ranAndReadBack(await serving(await environment(), false));

      expect([keeping.answered['prompt'], keeping.read['prompt'], inline.read['prompt']]).toEqual([
        prompt,
        prompt,
        prompt,
      ]);
      expect(Object.keys(keeping.read)).toEqual(Object.keys(inline.read));
      expect(keeping.onAPage).toMatchObject({ record: keptPrompt });
      expect(keeping.onAPage).not.toHaveProperty('record.prompt');
      expect(keeping.whole).toMatchObject({ ...keptPrompt, prompt });
      expect(inline.onAPage).not.toHaveProperty('record.prompt_sha256');
      expect(inline.whole).toMatchObject({ prompt });
      expect(inline.whole).not.toHaveProperty('prompt_sha256');
    },
  );

  it.skipIf(skipped)(
    'reads a prompt kept while the switch was on once it is off, whole, so turning the switch off takes no prompt from a run',
    async () => {
      const store = await environment();
      const ledger = temporaryLedger();
      onTestFinished(ledger.remove);
      await ranWhileKeeping(store, ledger);
      const switchedOff = await servingOver(store, false, ledger);
      onTestFinished(switchedOff.stop);

      const read = decodeRun((await switchedOff.call('GET', `${alpha}/runs/${runId}`)).body).record;
      const history = await switchedOff.call('GET', `${alpha}/runs/${runId}/history`);
      const ending = decodeEvents(history.body).events.find(({ type }) => type === 'run_succeeded');

      expect(read['prompt']).toEqual(prompt);
      expect(ending).toMatchObject({ data: { record: keptPrompt } });
    },
  );
});
