import { randomUUID } from 'node:crypto';

import { internalTermsIn } from '@on.auto/operations/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
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
  const name = `reading_${randomUUID().replaceAll('-', '')}`;
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

const succeeded = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const rejected = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const EventsSchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String })),
  next_cursor: Schema.NullOr(Schema.String),
});

const eventsOf = Schema.decodeUnknownSync(EventsSchema);

const RunsSchema = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String })),
  next_cursor: Schema.NullOr(Schema.String),
});

const runsOf = Schema.decodeUnknownSync(RunsSchema);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function eventually(path: string, holds: (response: TestResponse) => boolean): Promise<TestResponse> {
  return until(() => server.call('GET', path), holds);
}

function holding(count: number): (response: TestResponse) => boolean {
  return ({ status, body }) =>
    status === 200 && (Schema.is(EventsSchema)(body) ? body.events.length : runsOf(body).runs.length) === count;
}

async function playbookWithTwoRuns(environment: Readonly<Record<string, string>>): Promise<void> {
  server = await servingReasoning([answers(textResult('Profits\u0000rose.'))], environment);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
    body: { input: { text: 'the\u0000quarter' }, run_id: succeeded },
  });
  await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
    body: { input: { text: 7 }, run_id: rejected },
  });
}

function nextPageOf({ body }: TestResponse): string {
  return `${alpha}/runs?cursor=${String(runsOf(body).next_cursor)}`;
}

describe.each(stores)('the runs of a playbook over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('are listed newest first, filtered, and paged through', async () => {
    await playbookWithTwoRuns(await environment());

    const listed = await eventually(`${alpha}/runs`, holding(2));
    const filtered = await server.call('GET', `${alpha}/runs?status=succeeded&type=reasoning&name=summary`);
    const first = await server.call('GET', `${alpha}/runs?limit=1`);
    const next = await server.call('GET', nextPageOf(first));

    expect(listed).toMatchObject({
      status: 200,
      body: {
        runs: [
          { run_id: rejected, status: 'rejected', rejection: { reason: 'invalid_input' } },
          { run_id: succeeded, status: 'succeeded', type: 'reasoning', name: 'summary', definition_version: 1 },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
    expect(listed.body).not.toHaveProperty('runs.1.output');
    expect([filtered, next].map(({ body }) => runsOf(body).runs.map(({ run_id: id }) => id))).toEqual([
      [succeeded],
      [succeeded],
    ]);
  });
});

describe.each(stores)('the history of a run over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('reads a run whose input and output hold U+0000', async () => {
    await playbookWithTwoRuns(await environment());

    expect(await eventually(`${alpha}/runs/${succeeded}/history`, holding(4))).toMatchObject({
      status: 200,
      body: {
        events: [
          { type: 'run_started', data: { input: { text: 'the\u0000quarter' } }, metadata: { run_id: succeeded } },
          { type: 'model_call_started', metadata: { run_id: succeeded } },
          { type: 'model_call_answered', metadata: { run_id: succeeded } },
          { type: 'run_succeeded', data: { output: 'Profits\u0000rose.' }, metadata: { run_id: succeeded } },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
    expect(await server.call('GET', `${alpha}/runs/0199a3c4-7d2e-7c1a-9b3f-000000000000/history`)).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });
});

describe.each(stores)('the events of a playbook over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('follow what happened in the playbook, in plain words, by type', async () => {
    await playbookWithTwoRuns(await environment());

    const feed = eventsOf((await eventually(`${alpha}/events`, holding(7))).body);
    const created = eventsOf((await server.call('GET', `${alpha}/events?type=definition_created`)).body);

    expect(feed.events.map(({ type }) => type)).toEqual([
      'run_rejected',
      'run_started',
      'run_succeeded',
      'model_call_answered',
      'model_call_started',
      'run_started',
      'definition_created',
    ]);
    expect(feed.events.flatMap(({ summary: words }) => internalTermsIn(words))).toEqual([]);
    expect(created.events.map(({ summary: words }) => words)).toEqual([
      'The reasoning function “summary” was created.',
    ]);
  });
});

const aMessageId: unknown = expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);

const monthClosed = { id: 'm-1', source: '/ledger/eu', type: 'com.acme.ledger.month-closed', data: 'eu' };

function publishing(event: object): Promise<TestResponse> {
  return server.call('POST', `${alpha}/events`, { body: { event } });
}

describe.each(stores)('the events published to a playbook over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('are recorded once for a source and id, refused when they clash, and in the feed', async () => {
    server = await servingReasoning([], await environment());
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const published = await publishing(monthClosed);
    const again = await publishing(monthClosed);
    const clash = await publishing({ ...monthClosed, data: 'us' });
    const reserved = await publishing({ source: '/definitions/reasoning/summary', type: 'definition_created' });
    const feed = await eventually(`${alpha}/events?type=event_published`, holding(1));

    expect([published.status, again.body, clash.status, reserved.body]).toMatchObject([
      200,
      published.body,
      409,
      { reason: 'invalid_input', errors: [{ pointer: '/event/type' }, { pointer: '/event/source' }] },
    ]);
    expect(feed.body).toMatchObject({
      events: [
        {
          id: aMessageId,
          type: 'event_published',
          data: { event_id: 'm-1', source: '/ledger/eu', data: 'eu' },
          metadata: { causation_id: null },
        },
      ],
    });
    expect(eventsOf(feed.body).events.map(({ summary: words }) => words)).toEqual([
      'The event “com.acme.ledger.month-closed” was published to the playbook.',
    ]);
  });
});

describe.each(stores)('a retired playbook over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)('keeps its runs and events readable, while a change is refused', async () => {
    await playbookWithTwoRuns(await environment());
    await server.call('POST', '/v1/orgs/acme/playbooks/alpha/retire');

    const reads = await Promise.all(
      [`${alpha}/runs`, `${alpha}/runs/${succeeded}/history`, `${alpha}/events`].map((path) =>
        server.call('GET', path),
      ),
    );
    const change = await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'other', source: summary },
    });

    expect(reads.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(change).toMatchObject({
      status: 409,
      body: { reason: 'conflict', detail: 'The playbook alpha is retired and can no longer change' },
    });
  });

  it.skipIf(skipped)('refuse a cursor the playbook did not give', async () => {
    await playbookWithTwoRuns(await environment());

    expect(await server.call('GET', `${alpha}/events?cursor=not-a-cursor`)).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/cursor' }] },
    });
  });
});

const historyOfARun = ['run_started', 'model_call_started', 'model_call_answered', 'run_succeeded'];

async function anAppendLeftOpen(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY[$2::jsonb], ARRAY['1'], ARRAY['note_added'], ARRAY['E'],
      'playbook/acme/alpha/notes', 'playbook', 0, 'emt:default')`,
    [{ json: JSON.stringify({ text: 'late' }) }, { at: '2026-10-05T09:00:00.000Z', by: 'tester' }],
  );
  return client;
}

describe.skipIf(postgresql === '')(
  `the history of a run behind an append left open, on PostgreSQL${postgresqlNotice}`,
  () => {
    it('is an empty page oldest first, not not_found, and the events once the append commits', async () => {
      const environment = await onADatabaseOfItsOwn();
      server = await servingReasoning([answers(textResult('Profits rose.'))], environment);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
      const open = await anAppendLeftOpen(String(environment['DATABASE_URL']));
      await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
        body: { input: { text: 'the quarter' }, run_id: succeeded },
      });

      const run = await server.call('GET', `${alpha}/runs/${succeeded}`);
      const behind = await server.call('GET', `${alpha}/runs/${succeeded}/history`);
      const newestFirst = await server.call('GET', `${alpha}/runs/${succeeded}/history?order=desc`);
      await open.query('COMMIT');
      const after = await eventually(`${alpha}/runs/${succeeded}/history`, holding(4));

      expect(run).toMatchObject({ status: 200, body: { status: 'succeeded' } });
      expect(behind).toMatchObject({ status: 200, body: { events: [], has_more: false, next_cursor: null } });
      expect(eventsOf(newestFirst.body).events.map(({ type }) => type)).toEqual(historyOfARun.toReversed());
      expect(eventsOf(after.body).events.map(({ type }) => type)).toEqual(historyOfARun);
    });
  },
);
