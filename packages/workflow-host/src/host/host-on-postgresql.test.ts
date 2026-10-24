import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { reactionSuite } from '../reaction-testing/reaction-suite.ts';
import { dispatchSuite } from '../suite-testing/dispatch-suite.ts';
import { failureSuite } from '../suite-testing/failure-suite.ts';
import { claimSuite, leaseSuite } from '../suite-testing/lease-suite.ts';
import { longRunSuite } from '../suite-testing/long-run-suite.ts';
import { portSuite } from '../suite-testing/port-suite.ts';
import { runSuite } from '../suite-testing/run-suite.ts';
import { databaseSettingsOf, type ProcessDatabasesOf } from '../testing/host-processes.ts';

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

const processDatabaseOnPostgreSQL: ProcessDatabasesOf = async () => {
  const name = `workflow_host_${crypto.randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  await administered(`ALTER DATABASE ${name} SET synchronous_commit = off`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return { store: 'postgresql', connectionString: database.href };
};

const onPostgreSQL = async () => databaseSettingsOf(await processDatabaseOnPostgreSQL());

describe.skipIf(skipped)(`the host on PostgreSQL${notice}`, () => {
  describe('its ports', () => {
    portSuite(onPostgreSQL);
  });

  describe('a workflow it runs', () => {
    runSuite(onPostgreSQL);
  });

  describe('its waiting calls, dispatched again', () => {
    dispatchSuite(onPostgreSQL);
  });

  describe('a long run', () => {
    longRunSuite(onPostgreSQL);
  });

  describe('killed while it dispatches, then started again', () => {
    failureSuite(processDatabaseOnPostgreSQL);
  });

  describe('the reactions of its playbooks', () => {
    reactionSuite(onPostgreSQL);
  });

  describe('one of two hosts on one database', () => {
    leaseSuite(processDatabaseOnPostgreSQL);
    claimSuite(processDatabaseOnPostgreSQL, 'database');
  });
});
