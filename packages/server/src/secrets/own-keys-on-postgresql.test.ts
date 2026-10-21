import { randomUUID } from 'node:crypto';

import { retriedWith, stateAskedBy } from '@on.auto/api/testing';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { ownKeysStream } from './own-keys.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const secretsKey = Buffer.alloc(32, 7).toString('base64');

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function queried(
  url: string,
  statement: string,
  values: readonly string[] = [],
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement, [...values]);
    return rows;
  } finally {
    await client.end();
  }
}

async function aDatabaseOfItsOwn(): Promise<string> {
  const name = `own_keys_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

async function servedOn(database: string): Promise<ReasoningServer> {
  const served = await servingReasoning([], { LEDGER_FILE: '', DATABASE_URL: database, SECRETS_KEY: secretsKey });
  onTestFinished(() => served.stop());
  return served;
}

function onMcpOf({ origin }: ReasoningServer) {
  return { url: `${origin}/mcp`, headers: {} };
}

const adding = {
  name: 'add_connection',
  arguments: {
    name: 'notes-raced',
    type: 'mcp',
    entry: { url: 'https://notes.example.com/mcp' },
    credential: { kind: 'none' },
  },
};

describe.skipIf(skipped)(`Two servers that start at once on one ledger in PostgreSQL${notice}`, () => {
  it('keep one key that signs the state of a retry between them, recorded once and kept in one row, so a retry one asked for is answered by the other', async () => {
    const database = await aDatabaseOfItsOwn();
    const [first, second] = await Promise.all([servedOn(database), servedOn(database)]);

    const state = await stateAskedBy(onMcpOf(first), adding);
    const retried = await retriedWith(onMcpOf(second), adding, state);

    expect(retried.structuredContent).toMatchObject({ name: 'notes-raced', status: 'pending' });
    expect(
      await queried(database, 'SELECT message_type FROM emt_messages WHERE stream_id = $1', [ownKeysStream]),
    ).toEqual([{ message_type: 'own_key_kept' }]);
    expect(await queried(database, 'SELECT count(*)::int AS rows FROM kept_secrets')).toEqual([{ rows: 1 }]);
  });
});
