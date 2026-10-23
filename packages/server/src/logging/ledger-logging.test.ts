import { resolve } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { logLedger } from './logging.ts';

describe('logLedger on SQLite', () => {
  it('names the file of a ledger in SQLite by its absolute path', async () => {
    const file = resolve('data/ledger.db');

    await expect(linesLoggedBy(logLedger({ store: 'sqlite', file: 'data/ledger.db' }))).resolves.toEqual([
      expect.stringContaining(`{"message":"The ledger is kept in the file ${file}","level":"INFO",`),
    ]);
    expect(await linesLoggedBy(logLedger({ store: 'sqlite', file: 'data/ledger.db' }))).toEqual([
      expect.stringContaining(`"annotations":{"ledger_file":"${file}"}`),
    ]);
  });

  it('names a private in-memory ledger as SQLite does', async () => {
    await expect(linesLoggedBy(logLedger({ store: 'sqlite', file: ':memory:' }))).resolves.toEqual([
      expect.stringContaining('{"message":"The ledger is kept in the file :memory:","level":"INFO",'),
    ]);
  });
});

describe('logLedger on PostgreSQL', () => {
  it('names the database and the host of a ledger in PostgreSQL, and nothing else of its URL', async () => {
    const lines = await linesLoggedBy(
      logLedger({
        store: 'postgresql',
        url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com:5432/playbooks?sslmode=require'),
        host: 'db.example.com:5432',
        database: 'playbooks',
        credentials: { kind: 'url' },
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"The ledger is kept in PostgreSQL, in the database playbooks on db.example.com:5432","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"database":"playbooks","database_host":"db.example.com:5432","database_credentials":"url"}',
    );
    expect(lines.join('\n')).not.toMatch(/a-secret-password|sslmode|postgresql:/u);
  });

  it('names the user and the region a ledger in PostgreSQL signs its tokens for, and no token', async () => {
    const { ledger } = readSettingsOf({
      DATABASE_URL: 'postgresql://auto_runtime@ledger.c9akciq32.eu-west-1.rds.amazonaws.com/playbooks',
      DATABASE_CREDENTIALS: 'aws-iam',
      SECRETS_KEY: secretsKey,
    });

    const lines = await linesLoggedBy(logLedger(ledger));

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"The ledger is kept in PostgreSQL, in the database playbooks on ledger.c9akciq32.eu-west-1.rds.amazonaws.com, signing in as auto_runtime with a token signed for each connection from the AWS credential chain, for the region eu-west-1","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"database":"playbooks","database_host":"ledger.c9akciq32.eu-west-1.rds.amazonaws.com","database_credentials":"aws-iam","database_user":"auto_runtime","database_region":"eu-west-1"}',
    );
    expect(lines.join('\n')).not.toMatch(/X-Amz|postgresql:/u);
  });
});
