import { randomUUID } from 'node:crypto';

import { bucketReady, emptied, keysIn, testObjectStoreOf } from '@on.auto/object-storage/testing';
import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { toolBounds } from '@on.auto/tool-servers';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const objectStore = process.env['CONTENT_TEST_OBJECT_STORE_URL'] ?? '';

const objectStoreNotice =
  objectStore === ''
    ? ', skipped: set CONTENT_TEST_OBJECT_STORE_URL to the URL of an S3-compatible server with its credentials and a bucket to run it'
    : '';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const calls = toolBounds.callsInRun;

const keptOfAToolCall = ['its arguments', 'its answer'];

const keptOfAModelCall = ['the messages it sent', 'its response'];

const modelCallsOfTheRun = ['the first, which asks for every call', 'the last, which tells the conversation again'];

const kibibytesOf = (call: number): number => 1000 + call;

const reading = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/large]', '---', 'Read it all.'].join('\n');

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
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'reading', source: reading } });
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
    'keeps the arguments and the answer of each call, and the messages and the response of each model call, as objects of the bucket under its playbook, and reads every answer back within the deadline of the run',
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
      expect(kept.every((key) => /^playbook\/acme\/alpha\/[0-9a-f]{64}$/u.test(key))).toBe(true);
      expect(took).toBeLessThan(toolBounds.runMs);
    },
  );
});
