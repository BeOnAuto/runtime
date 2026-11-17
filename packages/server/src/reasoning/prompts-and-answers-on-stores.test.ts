import { createHash, randomUUID } from 'node:crypto';

import { bucketReady, emptied, keysIn, testObjectStoreOf } from '@on.auto/object-storage/testing';
import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { toolBounds } from '@on.auto/tool-servers';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';

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

const shortText = 's'.repeat(3000);

function promptOf(given: string) {
  return { instructions: 'Be brief.', message: `Read: ${given}`, truncated: false };
}

function keptPromptOf(given: string) {
  const written = JSON.stringify(promptOf(given));
  return {
    prompt_sha256: createHash('sha256').update(written).digest('hex'),
    prompt_bytes: Buffer.byteLength(written, 'utf8'),
  };
}

const prompt = promptOf(text);

const keptPrompt = keptPromptOf(text);

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
    keptOutside,
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

async function ranAndReadBack(server: ReasoningServer, given = text) {
  const ran = await server.call('POST', `${alpha}/definitions/reasoning/reads/run`, {
    body: { input: { text: given }, run_id: runId },
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

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const objectStore = process.env['CONTENT_TEST_OBJECT_STORE_URL'] ?? '';

const objectStoreNotice =
  objectStore === ''
    ? ', skipped: set CONTENT_TEST_OBJECT_STORE_URL to the URL of an S3-compatible server with its credentials and a bucket to run it'
    : '';

const calls = 25;

const keptOfAToolCall = ['its arguments', 'its answer'];

const keptOfAModelCall = ['the messages it sent', 'its response'];

const modelCallsOfTheRun = ['the first, which asks for every call', 'the last, which reads every answer'];

const kibibytesOf = (call: number): number => 1000 + call;

const reading = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'tools: [graph/large]',
  `max_tool_calls: ${calls}`,
  'exit_behavior: continue',
  '---',
  'Read it all.',
].join('\n');

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
  const name = `large_answers_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey };
}

async function onAnObjectStorePrefixOfItsOwn(prefix: string): Promise<Readonly<Record<string, string>>> {
  const { bucket, endpoint, accessKeyId, secretAccessKey } = testObjectStoreOf(objectStore);
  await bucketReady(bucket);
  onTestFinished(() => emptied(bucket, prefix));
  vi.stubEnv('AWS_ACCESS_KEY_ID', accessKeyId);
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', secretAccessKey);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  return { CONTENT_STORE_URL: `s3://${bucket.name}/${prefix}`, AWS_ENDPOINT_URL: endpoint, AWS_REGION: 'us-east-1' };
}

async function objectsUnder(prefix: string): Promise<readonly string[]> {
  const kept = await keysIn(testObjectStoreOf(objectStore).bucket, prefix);
  return kept.map((key) => key.slice(prefix.length));
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

const decodeIds = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) }),
);

const decodeAnswered = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ result_bytes: Schema.Int, answer: Schema.String }) }),
);

async function servingLargeAnswers(environment: Readonly<Record<string, string>>): Promise<ReasoningServer> {
  const graph = await serveFakeMcp();
  onTestFinished(graph.close);
  const everyCall = Array.from({ length: calls }, (_, call) => ['graph__large', { kib: kibibytesOf(call) }] as const);
  const server = await servingReasoning([callingTools(everyCall, answers(textResult('Read them all.')))], {
    TOOL_SERVERS: JSON.stringify({ graph: { url: graph.url, org: 'acme' } }),
    ...environment,
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'reading', source: reading, diagram: 'none' },
  });
  return server;
}

interface ReadBack {
  readonly kibibytes: number;
  readonly whole: boolean;
}

async function answersReadBack(server: ReasoningServer): Promise<readonly ReadBack[]> {
  const history = await server.call('GET', `${alpha}/runs/${runId}/history?limit=100`);
  const answered = decodeIds(history.body).events.filter(({ type }) => type === 'tool_call_answered');
  return Promise.all(
    answered.map(async ({ id }) => {
      const { data } = decodeAnswered((await server.call('GET', `${alpha}/events/${id}`)).body);
      const answerBytes = Buffer.byteLength(data.answer, 'utf8');
      return { kibibytes: answerBytes / 1024, whole: data.result_bytes > answerBytes };
    }),
  );
}

describe('a reasoning run whose prompt is past 16,384 bytes', () => {
  it('keeps the prompt outside its ending where the server keeps large values outside, and answers and shows the run as a server that keeps it inline does', async () => {
    const keeping = await ranAndReadBack(await serving({}, true));
    const inline = await ranAndReadBack(await serving({}, false));

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
  });

  it('reads a prompt kept while the switch was on once it is off, whole, so turning the switch off takes no prompt from a run', async () => {
    const store = {};
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
  });
});

describe('a reasoning run under the payload size threshold the server is given', () => {
  it('keeps the prompt by the server’s payload size threshold, as it keeps an output: inline at 65,536 bytes, and by its digest past 2,048 for a prompt of 3 KB', async () => {
    const atTheCap = await ranAndReadBack(await serving({ PAYLOAD_SIZE_THRESHOLD_BYTES: '65536' }, true));
    const atTheFloor = await ranAndReadBack(await serving({ PAYLOAD_SIZE_THRESHOLD_BYTES: '2048' }, true), shortText);

    expect(atTheCap.onAPage).not.toHaveProperty('record.prompt_sha256');
    expect(atTheCap.whole).toMatchObject({ prompt });
    expect(atTheFloor.onAPage).toMatchObject({ record: keptPromptOf(shortText) });
    expect(atTheFloor.read['prompt']).toEqual(promptOf(shortText));
  });
});

describe.each(stores)('a reasoning run whose every call answers 1 MB, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'keeps each answer whole and reads every one back within the deadline of the run',
    { timeout: toolBounds.runMs },
    async () => {
      const server = await servingLargeAnswers(await environment());
      const started = performance.now();

      const ran = await server.call('POST', `${alpha}/definitions/reasoning/reading/run`, {
        body: { input: {}, run_id: runId },
      });
      const readBack = await answersReadBack(server);
      const took = performance.now() - started;

      expect(ran.body).toMatchObject({ status: 'succeeded', output: 'Read them all.' });
      expect(readBack).toHaveLength(calls);
      expect(readBack).toEqual(
        expect.arrayContaining(
          Array.from({ length: calls }, (_, call) => ({ kibibytes: kibibytesOf(call), whole: true })),
        ),
      );
      expect(took).toBeLessThan(toolBounds.runMs);
    },
  );
});

describe(`a reasoning run whose every call answers 1 MB, its content on object storage${objectStoreNotice}`, () => {
  it.skipIf(objectStore === '')(
    'keeps the arguments and the answer of each call, and the messages and the response of each model call, as objects of the bucket under its org and none under its playbook, and reads every answer back within the deadline of the run',
    { timeout: toolBounds.runMs },
    async () => {
      const prefix = `large-answers/${randomUUID()}`;
      const server = await servingLargeAnswers(await onAnObjectStorePrefixOfItsOwn(prefix));
      const started = performance.now();

      const ran = await server.call('POST', `${alpha}/definitions/reasoning/reading/run`, {
        body: { input: {}, run_id: runId },
      });
      const readBack = await answersReadBack(server);
      const took = performance.now() - started;
      const kept = await objectsUnder(`${prefix}/`);

      expect(ran.body).toMatchObject({ status: 'succeeded', output: 'Read them all.' });
      expect(readBack).toHaveLength(calls);
      expect(readBack).toEqual(
        expect.arrayContaining(
          Array.from({ length: calls }, (_, call) => ({ kibibytes: kibibytesOf(call), whole: true })),
        ),
      );
      expect(server.modelCalls()).toBe(modelCallsOfTheRun.length);
      expect(kept).toHaveLength(calls * keptOfAToolCall.length + modelCallsOfTheRun.length * keptOfAModelCall.length);
      expect(kept.filter((key) => !/^org\/acme\/[0-9a-f]{64}$/u.test(key))).toEqual([]);
      expect(await objectsUnder(`${prefix}/playbook/`)).toEqual([]);
      expect(took).toBeLessThan(toolBounds.runMs);
    },
  );
});
