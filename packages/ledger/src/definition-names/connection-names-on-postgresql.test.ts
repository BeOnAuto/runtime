import { randomUUID } from 'node:crypto';

import { ContextSchema, noLineage, streamPrefixOfOrg } from '@on.auto/operations';
import { definitionsPlaced, runIdsOfTheTests } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf } from '../event-appender.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from '../postgresql/postgresql-ledger.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function aDatabase(): Promise<string> {
  const name = `connection_names_${randomUUID().replaceAll('-', '')}`;
  const admin = await connected(server);
  await admin.query(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    const dropping = new Client({ connectionString: server });
    await dropping.connect();
    await dropping.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await dropping.end();
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const AnyFact = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

describe.skipIf(skipped)(
  `A fact of a definition appended through the streams of the connection on PostgreSQL${notice}`,
  () => {
    it('changes the definition’s row of names in its append, as an append of the ledger does', async () => {
      const opened = await openConnectionWith(
        postgresqlLedgerLayer({ pools: plainPoolsOn(await aDatabase()), definitionNames: definitionsPlaced }),
      );
      onTestFinished(opened.dispose);

      await Effect.runPromise(
        eventAppenderOf(opened.connection.streams, AnyFact)(
          'definition/acme/d1/remarks/placed',
          [{ type: 'remark_made', data: { text: 'alpha' } }],
          { expectedVersion: 0, context: { by: 'acme-admin', at: '2026-11-16T09:00:00.000Z' }, lineage: noLineage },
        ),
      );

      expect((await Effect.runPromise(opened.ledger.nameHeldBy('definition/acme/d1/')))?.playbookKey).toBe(
        'playbook/acme/alpha/',
      );
    });

    it('claims the id of a run with the run’s first fact, as an append of the ledger does', async () => {
      const opened = await openConnectionWith(
        postgresqlLedgerLayer({ pools: plainPoolsOn(await aDatabase()), runIds: runIdsOfTheTests }),
      );
      onTestFinished(opened.dispose);

      await Effect.runPromise(
        eventAppenderOf(opened.connection.streams, AnyFact)(
          'definition/acme/d1/runs/r1',
          [{ type: 'run_began', data: { at: '2026-11-17T09:00:00.000Z', fn: 'brief' } }],
          { expectedVersion: 0, context: { by: 'acme-admin', at: '2026-11-17T09:00:00.000Z' }, lineage: noLineage },
        ),
      );

      expect(
        await Effect.runPromise(
          opened.ledger.holderOfRunId({ orgKey: streamPrefixOfOrg({ org: 'acme' }), runId: 'r1' }),
        ),
      ).toBe('definition/acme/d1/');
    });
  },
);
