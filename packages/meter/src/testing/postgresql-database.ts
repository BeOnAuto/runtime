import { plainPoolsOn, postgresqlLedgerLayer, postgresqlSecretRows } from '@on.auto/ledger/postgresql';
import { Client } from 'pg';
import { onTestFinished } from 'vitest';

import { openedDatabase, wrappingKey, type MeterDatabase } from './database.ts';

async function queried(server: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function postgresqlDatabase(server: string): Promise<MeterDatabase> {
  const name = `meter_${crypto.randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(() => queried(server, `DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(server);
  url.pathname = `/${name}`;
  const pools = plainPoolsOn(url.href);
  return openedDatabase({
    layer: postgresqlLedgerLayer({ pools }),
    secretRows: postgresqlSecretRows({ pools }),
    key: wrappingKey(),
  });
}
