import { randomUUID } from 'node:crypto';

import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { assetsOnStoresSuite } from '../store-testing/assets-on-stores.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

describe.skipIf(skipped)(`the assets of playbooks on PostgreSQL${notice}`, () => {
  assetsOnStoresSuite(async (projections) => {
    const name = `generation_${randomUUID().replaceAll('-', '')}`;
    await administered(`CREATE DATABASE ${name}`);
    onTestFinished(async () => {
      await administered(`DROP DATABASE ${name} WITH (FORCE)`);
    });
    const database = new URL(server);
    database.pathname = `/${name}`;
    return postgresqlLedgerLayer({ pools: plainPoolsOn(database.href), projections });
  });
});
