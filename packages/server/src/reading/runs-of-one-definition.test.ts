import { randomUUID } from 'node:crypto';

import { withMcpSession } from '@on.auto/api/testing';
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

let server: ReasoningServer;

function inTurn(runIds: readonly string[], started: (runId: string) => Promise<unknown>): Promise<void> {
  return Effect.runPromise(Effect.forEach(runIds, (runId) => Effect.promise(() => started(runId)), { discard: true }));
}

afterEach(async () => {
  await server.stop();
});

async function threeReasoningRunsBehindFiveComputationRuns(environment: Readonly<Record<string, string>>) {
  server = await servingReasoning([], environment);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'echoed', source: echoed } });
  await inTurn(reasoningRuns, (runId) =>
    server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
      body: { input: { text: 7 }, run_id: runId },
    }),
  );
  await inTurn(newerComputationRuns, (runId) =>
    server.call('POST', `${alpha}/definitions/computation/echoed/run`, {
      body: { input: {}, run_id: runId },
    }),
  );
}

function figuresOf({ runs, has_more: hasMore }: RunsPage): readonly [readonly string[], boolean] {
  return [runs.map(({ run_id: id }) => id), hasMore];
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
      expect(pagesOverHttp.flatMap(({ runs }) => runs.map(({ type }) => type))).toEqual([
        'reasoning',
        'reasoning',
        'reasoning',
      ]);
    },
  );
});
