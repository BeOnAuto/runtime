import { textToKeep } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { keptContentGraceMs } from '@on.auto/operations';
import { heldNotes, noteHolders } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import { until } from '../testing/until.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

const alpha = { org: 'acme', playbook: 'alpha' };

const prefix = 'playbook/acme/alpha/';

const orgKey = 'org/acme/';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const pastItsHour = keptAt + keptContentGraceMs + 1;

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

async function untilOneWaitsOnALock(database: string): Promise<void> {
  await until(
    () => postgresqlQueried(database, waitingOnALock),
    (rows) => JSON.stringify(rows) === JSON.stringify([{ waiting: 1 }]),
  );
}

async function aLedgerHolding(database: string) {
  const { ledger, dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), holders: noteHolders }),
  );
  onTestFinished(dispose);
  const { sha256 } = await at(keptAt, ledger.content.put(alpha, textToKeep('{"note":1}', 'application/json')));
  return { ledger, sha256 };
}

async function theDigestLockedBy(database: string, sha256: string): ReturnType<typeof postgresqlConnected> {
  const holding = await postgresqlConnected(database);
  await holding.query('BEGIN');
  await holding.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `content_references_2:${orgKey}${sha256}`,
  ]);
  return holding;
}

describe.skipIf(skipped)(`The holds on a content beside its removal on PostgreSQL${notice}`, () => {
  it('waits to remove a content while a fold holds the lock of its digest, and answers held once that fold commits its hold', async () => {
    const database = await aDatabase();
    const { ledger, sha256 } = await aLedgerHolding(database);
    const folding = await theDigestLockedBy(database, sha256);
    await folding.query(
      `INSERT INTO content_references_2 (org_key, playbook_key, stream, sha256, held) VALUES ($1, $2, 'notes/n1', $3, 1)`,
      [orgKey, prefix, sha256],
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

    expect(
      await postgresqlQueried(database, 'SELECT stream, sha256, held::int AS held FROM content_references_2'),
    ).toEqual([{ stream: 'notes/n1', sha256, held: 1 }]);
    expect(await at(pastItsHour, ledger.removeUnheld(alpha, sha256))).toBe('held');
  });
});
