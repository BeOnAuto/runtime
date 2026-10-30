import { randomUUID } from 'node:crypto';

import { listedTools, withMcpSession } from '@on.auto/api/testing';
import { uploadedWeeklyOrders } from '@on.auto/prediction/testing';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { answeredBeforeTheBody, keptText, sha256Of, uploaded } from './dataset-uploads.ts';

const uploadTimeoutMs = 120_000;

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

type Environment = Readonly<Record<string, string>>;

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

function onSQLite(): Promise<Environment> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({ LEDGER_FILE: ledger.fileName });
}

async function onPostgreSQL(): Promise<Environment> {
  const name = `datasets_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly environment: () => Promise<Environment>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, environment: onSQLite },
  { store: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', environment: onPostgreSQL },
];

async function serving(environment: Environment): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

const features = Array.from({ length: 40 }, (_, at) => `f${String(at + 1).padStart(2, '0')}`);

function largestDataset(): string {
  const values = Array.from({ length: 41 }, (_, at) => String(100_000 + at)).join(',');
  const days = Array.from({ length: 200 }, (_, day) => new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const rows = Array.from(
    { length: 1000 },
    (_, series) => `region-${String(series).padStart(4, '0')}-${'x'.repeat(23)}`,
  )
    .flatMap((series) => days.map((day) => `${series},${day},${values}\r\n`))
    .join('');
  return `${['series', 'period', 'orders', ...features].join(',')}\r\n${rows}`;
}

const weeks = 'series,period,orders,basket,promotion\r\nnorth,2026-W40,2,30,1\r\nnorth,2026-W41,0,,\r\n';

const faulty = 'series,period,orders,basket,promotion\r\nnorth,2026-W40,2,30,1\r\nnorth,2026-W41,two,,\r\n';

const another = sha256Of('another body');

const refusedAtItsLine: unknown = expect.objectContaining({
  reason: 'invalid_input',
  errors: [{ pointer: '', detail: 'Line 3: The value "two" is not a JSON number or empty' }],
});

const lengthRequired: unknown = expect.objectContaining({ reason: 'length_required' });

const tooLarge: unknown = expect.objectContaining({
  reason: 'content_too_large',
  detail: 'The body is larger than the 67,108,864 bytes this operation takes',
});

describe.each(stores)('the largest dataset uploaded over HTTP, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'is kept whole at the most a dataset takes, 200,000 rows over 1,000 series and 41 columns in 67,000,182 bytes, and answers its figures',
    async () => {
      const kept = await environment();
      const server = await serving(kept);
      const dataset = largestDataset();
      const answer = await uploaded(server.origin, dataset);
      await server.stop();

      expect(answer).toEqual({
        status: 200,
        body: {
          dataset: sha256Of(dataset),
          bytes: 67_000_182,
          rows: 200_000,
          series: 1000,
          columns: ['orders', ...features],
          period: 'day',
          first_period: '2026-01-01',
          last_period: '2026-07-19',
        },
      });
      expect(sha256Of(String(await keptText(kept, sha256Of(dataset))))).toBe(sha256Of(dataset));
    },
    uploadTimeoutMs,
  );
});

describe.each(stores)('a dataset uploaded over HTTP that is refused, on $store', ({ skipped, environment }) => {
  it.skipIf(skipped)(
    'is refused at its first faulty line, or when its digest is not the path’s, and nothing is kept',
    async () => {
      const kept = await environment();
      const server = await serving(kept);
      const refused = await uploaded(server.origin, faulty);
      const misnamed = await uploaded(server.origin, weeks, another);
      await server.stop();

      expect(refused).toEqual({ status: 422, body: refusedAtItsLine });
      expect(misnamed).toMatchObject({
        status: 422,
        body: {
          errors: [
            { pointer: '/sha256', detail: `The body's digest is ${sha256Of(weeks)} and the path says ${another}` },
          ],
        },
      });
      expect(
        await Promise.all([sha256Of(faulty), sha256Of(weeks), another].map((sha256) => keptText(kept, sha256))),
      ).toEqual([undefined, undefined, undefined]);
    },
    uploadTimeoutMs,
  );
});

describe('the route a dataset is uploaded through', () => {
  it('refuses a body without a Content-Length, and one longer than 64 MiB, before the body is sent', async () => {
    const server = await serving(await onSQLite());
    const csv = { 'content-type': 'text/csv' };

    const withoutLength = await answeredBeforeTheBody(server.origin, { ...csv, 'transfer-encoding': 'chunked' });
    const tooLong = await answeredBeforeTheBody(server.origin, { ...csv, 'content-length': '67108865' });

    expect([withoutLength, tooLong]).toEqual([
      { status: 411, body: lengthRequired },
      { status: 413, body: tooLarge },
    ]);
  });

  it('is listed on no MCP endpoint, and a function that names what it kept stands on its upload, where one that names what it never kept is refused', async () => {
    const server = await serving(await onSQLite());
    const { body } = await uploaded(server.origin, weeks);
    await server.call('POST', `${alpha}/definitions/prediction`, {
      body: { name: 'weekly-orders', source: uploadedWeeklyOrders(sha256Of(weeks)) },
    });
    const neverKept = await server.call('POST', `${alpha}/definitions/prediction`, {
      body: { name: 'other-orders', source: uploadedWeeklyOrders(another) },
    });

    const tools = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => listedTools(await session.listTools()),
    );
    const read = await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`);

    expect(body).toMatchObject({ dataset: sha256Of(weeks), rows: 2, series: 1, period: 'week' });
    expect(tools.map(({ name }) => name)).not.toContain('upload_dataset');
    expect(read.body).toMatchObject({ standing: { dataset: { kind: 'uploaded', sha256: sha256Of(weeks) } } });
    expect([neverKept.status, neverKept.body]).toEqual([
      422,
      expect.objectContaining({
        errors: [
          {
            pointer: '/source',
            detail: `Line 10, /data/dataset: This playbook keeps no dataset under ${another.slice(0, 12)}…; upload it first, then name it`,
          },
        ],
      }),
    ]);
  });
});
