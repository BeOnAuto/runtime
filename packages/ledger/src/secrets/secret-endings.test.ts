import { dumbo } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { SecretRows } from '@on.auto/secrets';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteMostBoundValues } from '../connection/bound-values.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { boundedExecutor } from '../testing/bounded-executor.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { secretRowsOn } from './secret-rows.ts';

const fewerValues = 8;

const ids = Array.from({ length: 20 }, (_, at) => `secret-${at}`);

const endings = new Map(ids.map((id, at) => [id, String(1000 + at)]));

async function keptOnADatabaseOfFewerValues(mostBoundValues: number): Promise<SecretRows> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const options = { driver: sqlite3EventStoreDriver, fileName };
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions(options));
  const store = sqliteEventStore(() => ({ ...options, pool }));
  await store.migrate();
  const rows = secretRowsOn(boundedExecutor(pool.execute, fewerValues), () => store.close(), mostBoundValues);
  onTestFinished(() => rows.close());
  await Effect.runPromise(
    Effect.forEach(
      endings,
      ([id, endsWith]: readonly [string, string]) => rows.keep(id, { keptBy: 'ledger', held: `held-${id}` }, endsWith),
      {
        discard: true,
      },
    ),
  );
  return rows;
}

describe('the endings of the secrets on a database that allows fewer bound values than the ids asked', () => {
  it('are read in statements within its bound, and answered as one', async () => {
    const rows = await keptOnADatabaseOfFewerValues(fewerValues);

    expect(await Effect.runPromise(rows.endingsOf([...ids, 'secret-unknown']))).toEqual(endings);
  });

  it('are refused by that database when read in one statement past its bound', async () => {
    const rows = await keptOnADatabaseOfFewerValues(sqliteMostBoundValues);

    await expect(Effect.runPromise(rows.endingsOf(ids))).rejects.toThrow('too many SQL variables');
  });
});
