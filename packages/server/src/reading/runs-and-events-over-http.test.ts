import { randomUUID } from 'node:crypto';

import { type ToolResult, withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { answers, jsonResult, textResult } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { calling, lookingUp, systemRunId, type SystemServer } from '../testing/interaction-servers/system-calls.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { whenHeld } from '../testing/waiting/until.ts';

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

function readWhenHeld(path: string, holds: (response: TestResponse) => boolean): Promise<TestResponse> {
  return whenHeld(() => server.call('GET', path), holds);
}

function holding(count: number): (response: TestResponse) => boolean {
  return ({ status, body }) =>
    status === 200 && (Schema.is(EventsSchema)(body) ? body.events.length : runsOf(body).runs.length) === count;
}

const summaryFunction = { name: 'summary', source: summary, diagram: 'none' };

async function playbookWithTwoRuns(environment: Readonly<Record<string, string>>): Promise<void> {
  server = await servingReasoning([answers(textResult('Profits\u0000rose.'))], environment);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: summaryFunction });
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

const aMessageId: unknown = expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);

const monthClosed = { id: 'm-1', source: '/ledger/eu', type: 'com.acme.ledger.month-closed', data: 'eu' };

function publishing(event: object): Promise<TestResponse> {
  return server.call('POST', `${alpha}/events`, { body: { event } });
}

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

const definitions: readonly (readonly [string, string, string])[] = [
  ['reasoning', 'noted', '---\nmodel: anthropic/claude-sonnet-4-5\noutput:\n  shape: text\n---\nWrite a short note.'],
  [
    'computation',
    'noting',
    "---\nlanguage: typescript\noutput:\n  shape: text\n---\nexport default function (): Output {\n  return { text: 'A note.' };\n}",
  ],
  [
    'workflow',
    'kept-note',
    workflowSource('kept-note', "output:\n  shape: text\ndo:\n  - note:\n      set: { text: 'A note.' }\n"),
  ],
  [
    'interaction',
    'confirmed',
    '---\nto: owner\nexpires: P1D\ndeliver: agent\noutput:\n  schema:\n    type: object\n    required: [ok]\n    properties: { ok: { type: boolean } }\n---\nPlease confirm the note.',
  ],
];

const runIds: Readonly<Record<string, string>> = {
  reasoning: '0199a3c4-7d2e-7c1a-9b3f-888888888881',
  computation: '0199a3c4-7d2e-7c1a-9b3f-888888888882',
  workflow: '0199a3c4-7d2e-7c1a-9b3f-888888888883',
  interaction: '0199a3c4-7d2e-7c1a-9b3f-888888888884',
};

const runs: Record<string, unknown> = {};

function inTurn<Item>(items: readonly Item[], step: (item: Item) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((before, item) => before.then(() => step(item)), Promise.resolve());
}

async function readRun(type: string): Promise<void> {
  const path = `${alpha}/runs/${String(runIds[type])}`;
  const { body } = type === 'interaction' ? await server.call('GET', path) : await settledRun(server, path);
  runs[type] = body;
}

const kibibytes = 5120;

const wholeText = '😀'.repeat(kibibytes * 256);

const unknownEvent = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f';

const AnsweredSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.Struct({
    result_bytes: Schema.Int,
    result: Schema.Struct({ content: Schema.Tuple([Schema.Struct({ type: Schema.String, text: Schema.String })]) }),
    answer: Schema.String,
  }),
});

const decodeAnswered = Schema.decodeUnknownSync(AnsweredSchema);

const decodeShown = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Record(Schema.String, Schema.Json) }));

const wholeFields: ReadonlySet<string> = new Set(['result', 'answer']);

async function answeredInFull(): Promise<{ readonly server: SystemServer; readonly answered: string }> {
  const serverOneEvent = await lookingUp();
  await serverOneEvent.define('large', calling('large', [`    kib: ${kibibytes}`]));
  await serverOneEvent.runCall('large');
  const history = await serverOneEvent.history(systemRunId);
  const answered = history.find(({ type }) => type === 'tool_call_answered');
  return { server: serverOneEvent, answered: String(answered?.id) };
}

function readOverMcp(serverOneEvent: SystemServer, eventId: string): Promise<ToolResult> {
  return withMcpSession(
    'current revision',
    { url: `${serverOneEvent.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    (session) => session.callTool('get_event', { event_id: eventId }),
  );
}

async function onADatabaseOfItsOwnRunsOneDefinition(): Promise<Readonly<Record<string, string>>> {
  const name = `definition_runs_${randomUUID().replaceAll('-', '')}`;
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
  {
    store: `PostgreSQL${postgresqlNotice}`,
    skipped: postgresql === '',
    environment: onADatabaseOfItsOwnRunsOneDefinition,
  },
];

const echoed = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: Input): Output {',
  '  return input;',
  '}',
].join('\n');

const RunsPageSchema = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String, type: Schema.String })),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
});

type RunsPage = typeof RunsPageSchema.Type;

const runsPageOf = Schema.decodeUnknownSync(RunsPageSchema);

function runOf(index: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`;
}

const reasoningRuns = [1, 2, 3].map((index) => runOf(index));

const newerComputationRuns = [4, 5, 6, 7, 8].map((index) => runOf(index));

function inTurnRunsOneDefinition(
  runIdsRunsOneDefinition: readonly string[],
  started: (runId: string) => Promise<unknown>,
): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(runIdsRunsOneDefinition, (runId) => Effect.promise(() => started(runId)), { discard: true }),
  );
}

async function threeReasoningRunsBehindFiveComputationRuns(environment: Readonly<Record<string, string>>) {
  server = await servingReasoning([], environment);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/computation`, {
    body: { name: 'echoed', source: echoed, diagram: 'none' },
  });
  await inTurnRunsOneDefinition(reasoningRuns, (runId) =>
    server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
      body: { input: { text: 7 }, run_id: runId },
    }),
  );
  await inTurnRunsOneDefinition(newerComputationRuns, (runId) =>
    server.call('POST', `${alpha}/definitions/computation/echoed/run`, {
      body: { input: {}, run_id: runId },
    }),
  );
}

function figuresOf({
  runs: runsRunsOneDefinition,
  has_more: hasMore,
}: RunsPage): readonly [readonly string[], boolean] {
  return [runsRunsOneDefinition.map(({ run_id: id }) => id), hasMore];
}

async function overHttp(cursor?: string): Promise<RunsPage> {
  const next = cursor === undefined ? '' : `&cursor=${cursor}`;
  const { body } = await server.call('GET', `${alpha}/runs?type=reasoning&limit=2${next}`);
  return runsPageOf(body);
}

function overMcp(): Promise<readonly RunsPage[]> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    async (session) => {
      const first = await session.callTool('list_runs', { type: 'reasoning', limit: 2 });
      const firstPage = runsPageOf(first.structuredContent);
      const next = await session.callTool('list_runs', {
        type: 'reasoning',
        limit: 2,
        cursor: String(firstPage.next_cursor),
      });
      return [firstPage, runsPageOf(next.structuredContent)];
    },
  );
}

describe('runs and events over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the runs of a playbook over HTTP', () => {
    it('are listed newest first, filtered, and paged through', async () => {
      await playbookWithTwoRuns({});

      const listed = await readWhenHeld(`${alpha}/runs`, holding(2));
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

  describe('the history of a run over HTTP', () => {
    it('reads a run whose input and output hold U+0000', async () => {
      await playbookWithTwoRuns({});

      expect(await readWhenHeld(`${alpha}/runs/${succeeded}/history`, holding(4))).toMatchObject({
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

  describe('the events of a playbook over HTTP', () => {
    it('follow what happened in the playbook, in plain words, by type', async () => {
      await playbookWithTwoRuns({});

      const feed = eventsOf((await readWhenHeld(`${alpha}/events`, holding(7))).body);
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

  describe('the events published to a playbook over HTTP', () => {
    it('are recorded once for a source and id, refused when they clash, and in the feed', async () => {
      server = await servingReasoning([], {});
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

      const published = await publishing(monthClosed);
      const again = await publishing(monthClosed);
      const clash = await publishing({ ...monthClosed, data: 'us' });
      const reserved = await publishing({ source: '/definitions/reasoning/summary', type: 'definition_created' });
      const feed = await readWhenHeld(`${alpha}/events?type=event_published`, holding(1));

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

  describe('a retired playbook over HTTP', () => {
    it('keeps its runs and events readable, while a change is refused', async () => {
      await playbookWithTwoRuns({});
      await server.call('POST', '/v1/orgs/acme/playbooks/alpha/retire');

      const reads = await Promise.all(
        [`${alpha}/runs`, `${alpha}/runs/${succeeded}/history`, `${alpha}/events`].map((path) =>
          server.call('GET', path),
        ),
      );
      const change = await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'other', source: summary, diagram: 'none' },
      });

      expect(reads.map(({ status }) => status)).toEqual([200, 200, 200]);
      expect(change).toMatchObject({
        status: 409,
        body: { reason: 'conflict', detail: 'The playbook alpha is retired and cannot change until it is restored' },
      });
    });

    it('refuse a cursor the playbook did not give', async () => {
      await playbookWithTwoRuns({});

      expect(await server.call('GET', `${alpha}/events?cursor=not-a-cursor`)).toMatchObject({
        status: 422,
        body: { reason: 'invalid_input', errors: [{ pointer: '/cursor' }] },
      });
    });
  });

  describe.skipIf(postgresql === '')(
    `the history of a run behind an append left open, on PostgreSQL${postgresqlNotice}`,
    () => {
      it('is an empty page oldest first, not not_found, and the events once the append commits', async () => {
        const environment = await onADatabaseOfItsOwn();
        server = await servingReasoning([answers(textResult('Profits rose.'))], environment);
        await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
        await server.call('POST', `${alpha}/definitions/reasoning`, { body: summaryFunction });
        const open = await anAppendLeftOpen(String(environment['DATABASE_URL']));
        await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
          body: { input: { text: 'the quarter' }, run_id: succeeded },
        });

        const run = await server.call('GET', `${alpha}/runs/${succeeded}`);
        const behind = await server.call('GET', `${alpha}/runs/${succeeded}/history`);
        const newestFirst = await server.call('GET', `${alpha}/runs/${succeeded}/history?order=desc`);
        await open.query('COMMIT');
        const after = await readWhenHeld(`${alpha}/runs/${succeeded}/history`, holding(4));

        expect(run).toMatchObject({ status: 200, body: { status: 'succeeded' } });
        expect(behind).toMatchObject({ status: 200, body: { events: [], has_more: false, next_cursor: null } });
        expect(eventsOf(newestFirst.body).events.map(({ type }) => type)).toEqual(historyOfARun.toReversed());
        expect(eventsOf(after.body).events.map(({ type }) => type)).toEqual(historyOfARun);
      });
    },
  );
});

describe('run shapes over http', () => {
  beforeAll(async () => {
    server = await servingReasoning([answers(jsonResult({ text: 'A short note.' }))]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await inTurn(definitions, ([type, name, source]) =>
      server.call('POST', `${alpha}/definitions/${type}`, {
        body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
      }),
    );
    await inTurn(definitions, ([type, name]) =>
      server.call('POST', `${alpha}/definitions/${type}/${name}/run`, { body: { input: {}, run_id: runIds[type] } }),
    );
    await inTurn(
      definitions.map(([type]) => type),
      readRun,
    );
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('the shape a run says its output takes', () => {
    it('is the shape a reasoning function, a computation function or a workflow declares, on its run', () => {
      expect([runs['reasoning'], runs['computation'], runs['workflow']]).toMatchObject([
        { status: 'succeeded', output_shape: 'text', output: { text: 'A short note.' } },
        { status: 'succeeded', output_shape: 'text', output: { text: 'A note.' } },
        { status: 'succeeded', output_shape: 'text', output: { text: 'A note.' } },
      ]);
    });

    it('is none for a run of an interaction function, whose definition declares none', () => {
      expect(runs['interaction']).toMatchObject({ status: 'started' });
      expect(runs['interaction']).not.toHaveProperty('output_shape');
    });
  });
});

describe('one event read whole by its id', () => {
  it('joins in a 5 MiB answer of a tool and the document read from it over HTTP, and gives the sizes of both past 64 KiB over MCP', async () => {
    const { server: serverOneEvent, answered } = await answeredInFull();

    const overHttpOneEvent = await serverOneEvent.call('GET', `${alpha}/events/${answered}`);
    const overMcpOneEvent = await readOverMcp(serverOneEvent, answered);
    const { data } = decodeAnswered(overHttpOneEvent.body);

    expect(overHttpOneEvent.status).toBe(200);
    expect([data.result.content[0].text === wholeText, data.answer === wholeText]).toEqual([true, true]);
    expect(data.result_bytes).toBeGreaterThan(kibibytes * 1024);
    expect(overMcpOneEvent.structuredContent).toMatchObject({
      id: answered,
      type: 'tool_call_answered',
      data: { result_bytes: data.result_bytes, answer_bytes: kibibytes * 1024 + 2 },
    });
    expect(
      Object.keys(decodeShown(overMcpOneEvent.structuredContent).data).filter((key) => wholeFields.has(key)),
    ).toEqual([]);
  });

  it('answers not_found for an id the playbook does not hold, a step its record does not have, and an event of another playbook', async () => {
    const serverOneEvent = await lookingUp();
    await serverOneEvent.define('thread-replies');
    await serverOneEvent.runCall('thread-replies');
    const [started] = await serverOneEvent.history(systemRunId);
    await serverOneEvent.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });

    const refused = [
      await serverOneEvent.call('GET', `${alpha}/events/${unknownEvent}`),
      await serverOneEvent.call('GET', `${alpha}/events/${String(started?.id)}_1`),
      await serverOneEvent.call('GET', `/v1/orgs/acme/playbooks/beta/events/${String(started?.id)}`),
    ];
    const malformed = await serverOneEvent.call('GET', `${alpha}/events/not-an-event`);

    expect(refused.map(({ status }) => status)).toEqual([404, 404, 404]);
    expect(refused.map(({ body }) => body)).toMatchObject([
      { reason: 'not_found' },
      { reason: 'not_found' },
      { reason: 'not_found' },
    ]);
    expect(malformed).toMatchObject({ status: 422, body: { reason: 'invalid_input' } });
  });
});

describe('runs of one definition', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe.each(stores)('the runs of one capability, a page at a time, on $store', ({ skipped, environment }) => {
    it.skipIf(skipped)(
      'fill each page with as many of its runs as the limit asks, behind newer runs of another, over HTTP and MCP',
      async () => {
        await threeReasoningRunsBehindFiveComputationRuns(await environment());

        const first = await overHttp();
        const pagesOverHttp = [first, await overHttp(String(first.next_cursor))];
        const pagesOverMcp = await overMcp();

        const expected = [
          [[runOf(3), runOf(2)], true],
          [[runOf(1)], false],
        ];
        expect(pagesOverHttp.map((page) => figuresOf(page))).toEqual(expected);
        expect(pagesOverMcp.map((page) => figuresOf(page))).toEqual(expected);
        expect(
          pagesOverHttp.flatMap(({ runs: runsRunsOneDefinition }) => runsRunsOneDefinition.map(({ type }) => type)),
        ).toEqual(['reasoning', 'reasoning', 'reasoning']);
      },
    );
  });
});
