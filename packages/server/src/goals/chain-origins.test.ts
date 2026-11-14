import { randomUUID } from 'node:crypto';

import { plainPoolsOn } from '@on.auto/ledger/postgresql';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { postgresqlLedgerDatabase } from '../database/postgresql-ledger-database.ts';
import { sqliteLedgerDatabase } from '../database/sqlite-ledger-database.ts';
import { readOnTheLedger, type Opened } from '../testing/chains/chain-ledger.ts';
import { byAKey, byAPersonAndASchedule, countOf, expectedRuns } from '../testing/chains/chain-workflows.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly opened: () => Promise<Opened>;
}

async function administer(asked: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(asked);
  } finally {
    await client.end();
  }
}

function aLedgerFile(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

async function onADatabaseOfItsOwn(): Promise<Opened> {
  const name = `chain_origins_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return {
    environment: { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey },
    ledger: aLedgerFile(),
    database: () => postgresqlLedgerDatabase(plainPoolsOn(database.href)),
  };
}

function onAFile(): Promise<Opened> {
  const ledger = aLedgerFile();
  return Promise.resolve({ environment: {}, ledger, database: () => sqliteLedgerDatabase(ledger.fileName) });
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, opened: onAFile },
  { store: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', opened: onADatabaseOfItsOwn },
];

describe.each(stores)('the origin of a run’s chain from the ledger’s facts on $store', ({ skipped, opened }) => {
  it.skipIf(skipped)(
    'is the schedule, the person or the key behind every run, called, triggered or a scheduled workflow run by hand, and stays so once the calls of ended runs are emptied and from the ending a delivery holds',
    async () => {
      const ledger = await opened();
      const first = await byAPersonAndASchedule(ledger);
      const labels = new Map([...first.labels, ...(await byAKey(ledger, first.at))]);
      const runs = [...labels.keys()];
      const onTheLedger = await readOnTheLedger(ledger, runs);

      const counted = ['person', 'machine', 'schedule'].map((label) => countOf(labels, label));
      expect(counted.slice(0, 2)).toEqual([expectedRuns.person, expectedRuns.machine]);
      expect(counted[2]).toBeGreaterThanOrEqual(expectedRuns.schedule);
      expect(onTheLedger.before.origins).toEqual(labels);
      expect(onTheLedger.before.reads).toBeLessThanOrEqual(runs.length * 2);
      expect(onTheLedger.closed.closed).toBeGreaterThanOrEqual(runs.length);
      expect(onTheLedger.calls.map(({ kept }) => kept)).toEqual([0]);
      expect(onTheLedger.calls[0]?.calls).toBeGreaterThan(0);
      expect(onTheLedger.after).toEqual(onTheLedger.before);
      expect(onTheLedger.ended.origins).toEqual(labels);
      expect(onTheLedger.ended.reads).toBeLessThan(onTheLedger.before.reads);
    },
    120_000,
  );
});
