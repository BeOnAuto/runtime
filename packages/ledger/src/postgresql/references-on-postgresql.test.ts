import { textToKeep } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { keptContentGraceMs, randomUUIDv7 } from '@on.auto/operations';
import { heldNotes, noteHolders } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { until } from '../testing/until.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const alpha = { org: 'acme', playbook: 'alpha' };

const prefix = 'playbook/acme/alpha/';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const pastItsHour = keptAt + keptContentGraceMs + 1;

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `references_${randomUUIDv7().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

async function untilOneWaitsOnALock(database: string): Promise<void> {
  await until(async () => {
    expect(await queried(database, waitingOnALock)).toEqual([{ waiting: 1 }]);
  });
}

async function aLedgerHolding(database: string) {
  const { ledger, dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), holders: noteHolders }),
  );
  onTestFinished(dispose);
  const { sha256 } = await at(keptAt, ledger.content.put(alpha, textToKeep('{"note":1}', 'application/json')));
  return { ledger, sha256 };
}

async function theDigestLockedBy(database: string, sha256: string): Promise<Client> {
  const holding = await connected(database);
  await holding.query('BEGIN');
  await holding.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `content_references_1:${prefix}${sha256}`,
  ]);
  return holding;
}

describe.skipIf(skipped)(`The holds on a content beside its removal on PostgreSQL${notice}`, () => {
  it('waits to remove a content while a fold holds the lock of its digest, and answers held once that fold commits its hold', async () => {
    const database = await aDatabase();
    const { ledger, sha256 } = await aLedgerHolding(database);
    const folding = await theDigestLockedBy(database, sha256);
    await folding.query(
      `INSERT INTO content_references_1 (playbook_key, stream, sha256, held) VALUES ($1, 'notes/n1', $2, 1)`,
      [prefix, sha256],
    );

    const removing = at(pastItsHour, ledger.removeUnheld(alpha, sha256));
    await untilOneWaitsOnALock(database);
    await folding.query('COMMIT');

    expect(await removing).toBe('held');
  });

  it('waits to fold a hold while a removal holds the lock of its digest, and folds it once the removal ends', async () => {
    const database = await aDatabase();
    const { ledger, sha256 } = await aLedgerHolding(database);
    const removing = await theDigestLockedBy(database, sha256);

    const folding = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/n1', heldNotes, [{ type: 'note_kept', data: { sha256 } }]),
    );
    await untilOneWaitsOnALock(database);
    await removing.query('COMMIT');
    await folding;

    expect(await queried(database, 'SELECT stream, sha256, held::int AS held FROM content_references_1')).toEqual([
      { stream: 'notes/n1', sha256, held: 1 },
    ]);
    expect(await at(pastItsHour, ledger.removeUnheld(alpha, sha256))).toBe('held');
  });
});
