import { randomUUID } from 'node:crypto';

import { runCorrelationIn, runStartCursorIn } from '@on.auto/definitions';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { Ledger } from '@on.auto/operations';
import { Effect, Exit, ManagedRuntime } from 'effect';
import { Client } from 'pg';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
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

async function aDatabase(): Promise<string> {
  const name = `own_start_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return database.href;
}

function aLedgerOn(database: string): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

async function aWriteLeftOpen(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query('SELECT pg_current_xact_id()');
  return client;
}

const echoing = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: Input): Output {',
  '  return input;',
  '}',
].join('\n');

const everyPace = [
  '---',
  'description: Reads every pace computed',
  'runs:',
  '  type: computation',
  '  name: campaign-pace',
  '---',
  '',
].join('\n');

const pacedRunId = '0199a3c4-7d2e-7c1a-9b3f-000000000001';

const lookupRunId = '0199a3c4-7d2e-7c1a-9b3f-000000000002';

const aCursor: unknown = expect.any(String);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe.skipIf(postgresql === '')(
  `A lookup function that reads runs on PostgreSQL while a write begun before its start is still open${notice}`,
  () => {
    it('reads from its own start, and the start and the correlation of a run are read past that write', async () => {
      const database = await aDatabase();
      server = await servingReasoning([], { LEDGER_FILE: '', DATABASE_URL: database, SECRETS_KEY: secretsKey });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/computation`, {
        body: { name: 'campaign-pace', source: echoing, diagram: 'none' },
      });
      await server.call('POST', `${alpha}/definitions/lookup`, {
        body: { name: 'every-pace', source: everyPace, diagram: 'none' },
      });
      await server.call('POST', `${alpha}/definitions/computation/campaign-pace/run`, {
        body: { input: { campaign: 'spring-sale' }, run_id: pacedRunId },
      });
      const ledger = await aLedgerOn(database);
      const held = await aWriteLeftOpen(database);

      const ran = await server.call('POST', `${alpha}/definitions/lookup/every-pace/run`, {
        body: { input: {}, run_id: lookupRunId },
      });
      const run = { org: 'acme', playbook: 'alpha', id: lookupRunId };
      const read = [
        await Effect.runPromise(Effect.exit(runStartCursorIn(ledger, run))),
        await Effect.runPromise(Effect.exit(runCorrelationIn(ledger, run))),
      ];
      await held.query('ROLLBACK');

      expect(ran.body).toMatchObject({
        status: 'succeeded',
        output: { runs: [{ run_id: pacedRunId, output: { campaign: 'spring-sale' } }], more: false },
      });
      expect(read).toEqual([Exit.succeed(aCursor), Exit.succeed(lookupRunId)]);
    });
  },
);
