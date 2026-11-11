import { DatabaseSync } from 'node:sqlite';

import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { loopbackSettingsOver, servingReasoning } from '../testing/servers/reasoning-server.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  server === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const putAtLayout17 = [
  'DROP TABLE workflow_reaction_refusals',
  'CREATE TABLE workflow_reaction_refusals (playbook_key TEXT NOT NULL, workflow TEXT NOT NULL, version INTEGER NOT NULL, minute BIGINT NOT NULL, count INTEGER NOT NULL, reason TEXT NOT NULL, recorded INTEGER NOT NULL DEFAULT 0, kind TEXT, because TEXT, trigger_kind TEXT, trigger_reference TEXT, PRIMARY KEY (playbook_key, workflow))',
  'ALTER TABLE workflow_subscriptions DROP COLUMN held_due',
  "INSERT INTO workflow_reaction_refusals (playbook_key, workflow, version, minute, count, reason, recorded, kind, because, trigger_kind, trigger_reference) VALUES ('playbook/acme/alpha/', 'close', 3, 60000, 2, 'Refused by its schedule', 1, 'credits_exhausted', 'free_daily_limit', 'cron', '/schedule/cron')",
  "INSERT INTO workflow_reaction_refusals (playbook_key, workflow, version, minute, count, reason, recorded) VALUES ('playbook/acme/alpha/', 'listen', 1, 120000, 1, 'Refused a listen task', 1)",
  'UPDATE ledger_layout SET layout = 17',
];

const refusalsRead =
  'SELECT workflow, count, reason, kind, because, trigger_kind, trigger_reference FROM workflow_reaction_refusals ORDER BY workflow';

const carried = [
  {
    workflow: 'close',
    count: 2,
    reason: 'Refused by its schedule',
    kind: 'credits_exhausted',
    because: 'free_daily_limit',
    trigger_kind: 'cron',
    trigger_reference: '/schedule/cron',
  },
  {
    workflow: 'listen',
    count: 1,
    reason: 'Refused a listen task',
    kind: null,
    because: null,
    trigger_kind: '',
    trigger_reference: '',
  },
];

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aPostgreSQLDatabase(): Promise<string> {
  const name = `server_${crypto.randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

async function editedOnPostgreSQL(database: string, statements: readonly string[]): Promise<void> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(statements.join(';\n'));
  } finally {
    await client.end();
  }
}

async function readOnPostgreSQL(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Record<string, unknown>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function servedOnPostgreSQL(database: string): Promise<void> {
  const opened = await servingReasoning([], { LEDGER_FILE: '', DATABASE_URL: database, SECRETS_KEY: secretsKey });
  await opened.stop();
}

describe('the refusals of a SQLite database of layout 17, carried to 18 by the server as it opens', () => {
  it('keep every row, each under the trigger it named, and a row with no trigger under an empty one', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await (await startServer(loopbackSettingsOver(ledger), compositionRoot)).stop();
    const atSeventeen = new DatabaseSync(ledger.fileName);
    for (const statement of putAtLayout17) atSeventeen.exec(statement);
    atSeventeen.close();

    await (await startServer(loopbackSettingsOver(ledger), compositionRoot)).stop();
    const atEighteen = new DatabaseSync(ledger.fileName, { readOnly: true });
    const rows = atEighteen.prepare(refusalsRead).all();
    atEighteen.close();

    expect(rows).toEqual(carried);
  });
});

describe.skipIf(server === '')(`the refusals of a PostgreSQL database of layout 17, carried to 18${notice}`, () => {
  it('keep every row, each under the trigger it named, and a row with no trigger under an empty one', async () => {
    const database = await aPostgreSQLDatabase();
    await servedOnPostgreSQL(database);
    await editedOnPostgreSQL(database, putAtLayout17);

    await servedOnPostgreSQL(database);

    expect(await readOnPostgreSQL(database, refusalsRead)).toEqual(carried);
  });
});
