import { randomUUID } from 'node:crypto';

import { retriedWith, stateAskedBy } from '@on.auto/api/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
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

const recordedOwnKeys = `SELECT message_type, (message_data ->> 'json')::jsonb ->> 'purpose' AS purpose,
  (message_data ->> 'json')::jsonb ->> 'secret_id' AS secret_id
  FROM emt_messages WHERE stream_id = $1 ORDER BY stream_position`;

function onMcpOf({ origin }: ReasoningServer) {
  return { url: `${origin}/mcp`, headers: {} };
}

async function addingANotesServer() {
  const notes = await serveFakeMcp();
  onTestFinished(notes.close);
  return {
    name: 'add_connection',
    arguments: { name: 'notes-raced', type: 'mcp', entry: { url: notes.url }, credential: { kind: 'none' } },
  };
}

describe.skipIf(skipped)(`Two servers that start at once on one ledger in PostgreSQL${notice}`, () => {
  it('keep one key of each purpose between them, the one that signs the state of a retry and the one that signs the addresses of content, each recorded once and kept in one row, so a retry one asked for is answered by the other', async () => {
    const database = await aDatabaseOfItsOwn();
    const [first, second] = await Promise.all([servedOn(database), servedOn(database)]);
    const adding = await addingANotesServer();

    const state = await stateAskedBy(onMcpOf(first), adding);
    const retried = await retriedWith(onMcpOf(second), adding, state);
    const recorded = await queried(database, recordedOwnKeys, [ownKeysStream]);
    const kept = await queried(database, 'SELECT id FROM kept_secrets ORDER BY id');

    expect(retried.structuredContent).toMatchObject({ name: 'notes-raced', status: 'pending' });
    expect(recorded.map(({ message_type, purpose }) => [message_type, purpose])).toEqual([
      ['own_key_kept', 'retry_state'],
      ['own_key_kept', 'content_address'],
    ]);
    expect(kept.map(({ id }) => String(id))).toEqual(recorded.map(({ secret_id }) => String(secret_id)).toSorted());
  });
});
