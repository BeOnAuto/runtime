import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { sha256Of, textToKeep } from '@on.auto/content';
import { Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { inTransactionOf, type LedgerStore, type ReturningExecutor, type TransactionalPool } from '../event-store.ts';
import { secretRowsOn } from '../secrets/secret-rows.ts';
import { pooledOptionsOf, sqliteEventStore } from '../sqlite-event-store.ts';
import { modestConnections } from '../sqlite3.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { sqliteMostBoundValues } from './bound-values.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const head = { bytes: 4, mediaType: 'text/plain' };

const digest = sha256Of('kept');

const longerThanAWriteTakesToReachSQLite = 250;

const waitingForNoLock = { pragmaOptions: { ...modestConnections.pragmaOptions, busy_timeout: 0 } };

interface OnePool {
  readonly store: LedgerStore;
  readonly pool: TransactionalPool<ReturningExecutor>;
}

async function aLedgerWhoseConnectionsWaitForNoLock(): Promise<OnePool> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const options = pooledOptionsOf(() => ({
    driver: sqlite3EventStoreDriver,
    fileName,
    connectionOptions: waitingForNoLock,
  }));
  const store = sqliteEventStore(() => options);
  await store.migrate();
  onTestFinished(() => store.close());
  return { store, pool: options.pool };
}

async function settledOnceTheWriterLetsGo<A, E>(
  pool: TransactionalPool<ReturningExecutor>,
  write: () => Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> {
  const begun = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
  const held = inTransactionOf(pool)(async () => {
    begun.resolve();
    await letGo.promise;
  });
  await begun.promise;
  const written = Effect.runPromiseExit(write());
  await Promise.race([written, Effect.runPromise(Effect.sleep(longerThanAWriteTakesToReachSQLite))]);
  letGo.resolve();
  await held;
  return written;
}

const holding = { keptBy: 'ledger', held: 'sealed' };

const holdingAgain = { keptBy: 'ledger', held: 'sealed again' };

describe('a write of the content of the ledger on SQLite, while the one writer of its pool is in a transaction', () => {
  it('keeps the head of a content kept outside the ledger once the transaction ends', async () => {
    const { store, pool } = await aLedgerWhoseConnectionsWaitForNoLock();
    const heads = store.externalHeadsWith(store.unlessHeld);

    const kept = await settledOnceTheWriterLetsGo(pool, () => heads.kept(alpha, digest, head, 1000));

    expect(kept).toEqual(Exit.succeed({ kept: 'new', head }));
  });

  it('keeps the time of a head that stands, kept outside the ledger, once the transaction ends', async () => {
    const { store, pool } = await aLedgerWhoseConnectionsWaitForNoLock();
    const heads = store.externalHeadsWith(store.unlessHeld);
    await Effect.runPromise(heads.kept(alpha, digest, head, 1000));

    const touched = await settledOnceTheWriterLetsGo(pool, () => heads.touched(alpha, digest, 2000));

    expect(touched).toEqual(Exit.succeed({ kept: 'standing', head }));
    expect(await Effect.runPromise(heads.read(alpha, digest))).toEqual({ ...head, keptAt: 2000 });
  });

  it('keeps a content of one chunk in the ledger once the transaction ends', async () => {
    const { store, pool } = await aLedgerWhoseConnectionsWaitForNoLock();

    const put = await settledOnceTheWriterLetsGo(pool, () =>
      store.content.put(alpha, textToKeep('kept', 'text/plain')),
    );

    expect(put).toEqual(Exit.succeed({ sha256: digest, bytes: 4, mediaType: 'text/plain' }));
  });
});

describe('a write of the rows of secrets on SQLite, while the one writer of their pool is in a transaction', () => {
  it('claims, replaces, holds again and forgets secrets once the transaction ends', async () => {
    const { pool } = await aLedgerWhoseConnectionsWaitForNoLock();
    const rows = secretRowsOn(pool.execute, () => Promise.resolve(), sqliteMostBoundValues);
    const ids = ['claimed', 'replaced', 'held again', 'forgotten'];
    await Effect.runPromise(Effect.forEach(ids, (id) => rows.keep(id, holding), { discard: true }));

    const written = await settledOnceTheWriterLetsGo(pool, () =>
      Effect.all(
        [
          Effect.map(rows.claim('claimed', 1, 60_000), ({ claimed }) => claimed),
          rows.replace('replaced', 1, holdingAgain),
          rows.reheld({ id: 'held again', version: 1, holding }, holdingAgain),
          rows.forget('forgotten'),
        ],
        { concurrency: 'unbounded' },
      ),
    );

    expect(written).toEqual(
      Exit.succeed([true, { replaced: true, version: 2 }, true, { ...holding, wrappedKey: undefined, kid: undefined }]),
    );
  });
});
