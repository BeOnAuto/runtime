import { randomUUID } from 'node:crypto';

import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const AnswerSchema = Schema.Struct({ cursor: Schema.String });

async function administer(url: string, statement: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aDatabaseOfItsOwn(): Promise<string> {
  const name = `server_${randomUUID().replaceAll('-', '')}`;
  await administer(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

function elapsed(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe.skipIf(skipped)(`A held request for the changes of a playbook on PostgreSQL${notice}`, () => {
  it('stays held through a read of the ledger that fails, and is answered once the ledger reads again', async () => {
    const database = await aDatabaseOfItsOwn();
    const serving = await servingReasoning([], {
      LEDGER_FILE: '',
      DATABASE_URL: database,
      SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    onTestFinished(() => serving.stop());
    await serving.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const now = Schema.decodeUnknownSync(AnswerSchema)((await serving.call('GET', `${alpha}/changes`)).body).cursor;

    const held = serving.call('GET', `${alpha}/changes?since=${now}&wait=20`);
    await elapsed(200);
    await administer(database, 'ALTER TABLE emt_messages RENAME TO emt_messages_away');
    await elapsed(1500);
    await administer(database, 'ALTER TABLE emt_messages_away RENAME TO emt_messages');
    await serving.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });

    expect(await held).toMatchObject({
      status: 200,
      body: { changes: [{ kind: 'definition', type: 'reasoning', name: 'summary' }] },
    });
  });
});
