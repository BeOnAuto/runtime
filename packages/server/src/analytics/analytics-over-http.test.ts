import { randomUUID } from 'node:crypto';

import { OutputInvalid } from '@on.auto/reasoning';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

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
  const name = `analytics_${randomUUID().replaceAll('-', '')}`;
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

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

function usageOf(input: number, cached: number, output: number) {
  return {
    input: { total: input, uncached: input - cached, cache_read: cached, cache_write: 0 },
    output: { total: output, text: output, reasoning: null },
    total: input + output,
  };
}

const unusable = new OutputInvalid({
  detail: 'The answer is not JSON',
  provider: 'anthropic',
  finish_reason: 'stop',
  raw_finish_reason: 'end_turn',
  usage: usageOf(300, 0, 20),
  issues: [],
});

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function playbookWithThreeRuns(environment: Readonly<Record<string, string>>): Promise<void> {
  server = await servingReasoning(
    [answers(textResult('Profits rose.', { usage: usageOf(1200, 1000, 80) })), () => Effect.fail(unusable)],
    environment,
  );
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  const running = (input: Readonly<Record<string, unknown>>) =>
    server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: { input } });
  await running({ text: 'the quarter' });
  await running({ text: 'the year' });
  await running({ text: 7 });
}

const decodeDays = Schema.decodeUnknownSync(
  Schema.Struct({
    by_day: Schema.Array(Schema.Struct({ day: Schema.String, runs: Schema.Struct({ total: Schema.Int }) })),
  }),
);

const decodeStarts = Schema.decodeUnknownSync(
  Schema.Struct({ runs: Schema.Array(Schema.Struct({ started_at: Schema.String })) }),
);

function dayOf(time: number | string): string {
  return new Date(time).toISOString().slice(0, 10);
}

function lastDayOf(body: unknown): string | undefined {
  return decodeDays(body).by_day.at(-1)?.day;
}

function runsByDay(body: unknown): readonly (readonly [string, number])[] {
  return decodeDays(body)
    .by_day.filter(({ runs }) => runs.total > 0)
    .map(({ day, runs }) => [day, runs.total]);
}

function runsByTheDayTheyStarted(body: unknown): readonly (readonly [string, number])[] {
  const days = decodeStarts(body).runs.map(({ started_at: startedAt }) => dayOf(startedAt));
  return [...new Set(days)].toSorted().map((day) => [day, days.filter((each) => each === day).length]);
}

const decodeDuration = Schema.decodeUnknownSync(
  Schema.Struct({ duration_ms: Schema.Struct({ p50: Schema.Int, p95: Schema.Int }) }),
);

function durationOf(body: unknown): { readonly p50: number; readonly p95: number } {
  return decodeDuration(body).duration_ms;
}

describe.each(stores)('the analytics of a playbook over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'count the runs that ended today, by how they ended, and the tokens their models used',
    async () => {
      await playbookWithThreeRuns(await environment());

      const readFrom = Date.now();
      const read = await server.call('GET', `${alpha}/analytics`);
      const readBy = Date.now();
      const started = await server.call('GET', `${alpha}/runs?type=reasoning&name=summary`);
      const filtered = await server.call('GET', `${alpha}/analytics?days=14&type=reasoning&name=summary`);

      expect(read).toMatchObject({
        status: 200,
        body: {
          days: 7,
          runs: { total: 3, succeeded: 1, failed: 0, rejected: 2 },
          tokens: { input: 1500, output: 100, cached: 1000 },
          by_function: [{ type: 'reasoning', name: 'summary', runs: 3 }],
        },
      });
      expect([dayOf(readFrom), dayOf(readBy)]).toContain(lastDayOf(read.body));
      expect(runsByDay(read.body)).toEqual(runsByTheDayTheyStarted(started.body));
      expect(durationOf(read.body).p50).toBeLessThanOrEqual(durationOf(read.body).p95);
      expect(filtered).toMatchObject({ status: 200, body: { days: 14, runs: { total: 3 } } });
    },
  );

  it.skipIf(skipped)('answer a retired playbook, and refuse a playbook that is not there', async () => {
    await playbookWithThreeRuns(await environment());
    await server.call('POST', '/v1/orgs/acme/playbooks/alpha/retire');

    const retired = await server.call('GET', `${alpha}/analytics?days=30`);
    const missing = await server.call('GET', '/v1/orgs/acme/playbooks/zeta/analytics');

    expect(retired).toMatchObject({ status: 200, body: { days: 30, runs: { total: 3 } } });
    expect(missing).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });
});

describe('the analytics of a playbook over HTTP, asked for what they cannot answer', () => {
  it('are refused as invalid input, pointing at what is wrong', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const refusals = await Promise.all(
      [
        'days=8',
        'days=7&from=2026-10-01',
        'from=2026-02-30&to=2026-03-01',
        'from=2026-10-01',
        'from=2026-10-01&to=9999-12-31',
        'limit=1',
      ].map((query) => server.call('GET', `${alpha}/analytics?${query}`)),
    );
    const since = await server.call('GET', `${alpha}/events?since=2026-02-30T00:00:00Z`);
    const midnight = await server.call('GET', `${alpha}/events?since=2026-10-05T24:00:00Z`);

    expect([...refusals, since, midnight].map(({ status, body }) => [status, body])).toMatchObject([
      [422, { reason: 'invalid_input', errors: [{ pointer: '/days' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/days' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/from' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/to' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/to' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/limit' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/since' }] }],
      [422, { reason: 'invalid_input', errors: [{ pointer: '/since' }] }],
    ]);
  });
});
