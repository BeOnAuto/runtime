import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Cause, Deferred, Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { modestConnections } from '../sqlite3.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import {
  aLedgerFile,
  anOpenLedger,
  causeOf,
  committed,
  exitOf,
  heldUntilLetGo,
  onAFile,
  places,
  rolledBack,
} from './held-ledger-file.ts';
import { LedgerNotOpen } from './sqlite-ledger-file.ts';
import { sqliteSecretRowsOn } from './sqlite-secret-rows.ts';

const longerThanSQLiteWaitsForItsLock = 5_500;

const longEnoughForAStatementToRun = 100;

const theLimitAWriteWaitsForItsTurn = 30_000;

const holding = { keptBy: 'ledger', held: 'sealed' };

const id = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function aMoment(): Promise<void> {
  return Effect.runPromise(Effect.sleep(longEnoughForAStatementToRun));
}

describe('the secret rows of a ledger file on SQLite, as they are written', () => {
  it(
    'keep a secret written while the writer of the ledger holds the file past the 5 s a statement waits for its lock, once it lets go',
    { timeout: 20_000 },
    async () => {
      const { rows, appended } = await anOpenLedger(onAFile);
      const letGo = await heldUntilLetGo(appended, committed);

      const kept = Effect.runPromiseExit(rows.keep(id, holding));
      await Effect.runPromise(Effect.sleep(longerThanSQLiteWaitsForItsLock));
      await letGo();

      expect(await kept).toEqual(Exit.void);
      expect(await Effect.runPromise(rows.read(id))).toMatchObject({ holding: { ...holding }, version: 1 });
    },
  );

  it('keep a secret written while a transaction of the ledger is open, though that transaction is rolled back', async () => {
    const { rows, appended } = await anOpenLedger(onAFile);
    const letGo = await heldUntilLetGo(appended, rolledBack);

    const kept = Effect.runPromiseExit(rows.keep(id, holding));
    const transaction = await letGo();

    expect([Exit.isFailure(transaction), await kept]).toEqual([true, Exit.void]);
    expect(await Effect.runPromise(rows.read(id))).toMatchObject({ holding: { ...holding } });
  });
});

describe('secret rows on a pool of their own, beside the ledger of a file on SQLite', () => {
  it(
    'fail with SQLITE_BUSY where the rows are opened on a pool of their own and the writer of the ledger holds the file past 5 s',
    { timeout: 20_000 },
    async () => {
      const { appended, named } = await anOpenLedger(onAFile);
      const rowsOfTheirOwn = await Effect.runPromise(
        sqliteSecretRowsOn(() => ({
          driver: sqlite3EventStoreDriver,
          fileName: named,
          connectionOptions: modestConnections,
        })),
      );
      onTestFinished(rowsOfTheirOwn.close);
      const letGo = await heldUntilLetGo(appended, committed);

      const refused = causeOf(rowsOfTheirOwn.keep(id, holding));
      await Effect.runPromise(Effect.sleep(longerThanSQLiteWaitsForItsLock));
      await letGo();
      const cause = await refused;

      expect(Cause.hasDies(cause)).toBe(true);
      expect(Cause.pretty(cause)).toContain('SQLITE_BUSY: database is locked');
      expect(await Effect.runPromise(rowsOfTheirOwn.read(id))).toBeUndefined();
    },
  );
});

describe.each(places)(
  'the secret rows of a ledger on SQLite, on $place, written inside a transaction of the ledger',
  (place) => {
    it('keep a secret whose write is started inside a transaction of the ledger, once it ends, though it is rolled back', async () => {
      const { rows, appended } = await anOpenLedger(place);
      const order: string[] = [];
      const write = Promise.withResolvers<Exit.Exit<void>>();
      const settles = Effect.sync(() => order.push('the write settles'));

      const transaction = await exitOf(
        appended(async () => {
          write.resolve(Effect.runPromiseExit(Effect.ensuring(rows.keep(id, holding), settles)));
          await aMoment();
          await rolledBack();
        }).finally(() => {
          order.push('the transaction ends');
        }),
      );

      expect([Exit.isFailure(transaction), await write.promise]).toEqual([true, Exit.void]);
      expect(await Effect.runPromise(rows.read(id))).toMatchObject({ holding: { ...holding } });
      expect(order).toEqual(['the transaction ends', 'the write settles']);
    });

    it(
      'refuse a secret whose write a transaction of the ledger waits for, at the limit a write waits for its turn, and keep nothing of it',
      { timeout: 45_000 },
      async () => {
        const { rows, appended } = await anOpenLedger(place);
        const refused = Promise.withResolvers<Cause.Cause<never>>();
        const began = performance.now();

        const transaction = await exitOf(
          appended(async () => {
            const refusal = causeOf(rows.keep(id, holding));
            refused.resolve(refusal);
            await refusal;
          }),
        );
        const waited = performance.now() - began;
        const cause = await refused.promise;

        expect([transaction, Cause.hasDies(cause)]).toEqual([Exit.void, true]);
        expect(Cause.pretty(cause)).toContain('Task was not started within the maximum waiting time');
        expect(waited).toBeGreaterThanOrEqual(theLimitAWriteWaitsForItsTurn);
        expect(await Effect.runPromise(rows.read(id))).toBeUndefined();
      },
    );
  },
);

describe.each(places)(
  'the secret rows of a ledger on SQLite, on $place, written by a fiber woken inside a transaction of the ledger',
  (place) => {
    it('keep a secret written by a fiber woken inside a transaction of the ledger, though it is rolled back', async () => {
      const { rows, appended } = await anOpenLedger(place);
      const woken = Effect.runSync(Deferred.make<void>());
      const fiber = Effect.runPromiseExit(Effect.andThen(Deferred.await(woken), rows.keep(id, holding)));

      const transaction = await exitOf(
        appended(async () => {
          Effect.runSync(Deferred.done(woken, Exit.void));
          await aMoment();
          await rolledBack();
        }),
      );

      expect([Exit.isFailure(transaction), await fiber]).toEqual([true, Exit.void]);
      expect(await Effect.runPromise(rows.read(id))).toMatchObject({ holding: { ...holding } });
    });

    it('keep a secret written later by a fiber woken inside a transaction of the ledger, though a later transaction is open and is rolled back', async () => {
      const { rows, appended } = await anOpenLedger(place);
      const woken = Effect.runSync(Deferred.make<void>());
      const later = Promise.withResolvers<void>();
      const writesLater = Effect.andThen(
        Effect.promise(() => later.promise),
        rows.keep(id, holding),
      );
      const fiber = Effect.runPromiseExit(Effect.andThen(Deferred.await(woken), writesLater));

      const first = await exitOf(
        appended(() => {
          Effect.runSync(Deferred.done(woken, Exit.void));
          return committed();
        }),
      );
      const second = await exitOf(
        appended(async () => {
          later.resolve();
          await aMoment();
          await rolledBack();
        }),
      );

      expect([first, Exit.isFailure(second), await fiber]).toEqual([Exit.void, true, Exit.void]);
      expect(await Effect.runPromise(rows.read(id))).toMatchObject({ holding: { ...holding } });
    });
  },
);

describe('the secret rows of a ledger file on SQLite, as they are read and opened', () => {
  it('read a secret while the writer of the ledger holds the file, waiting for no write, and close nothing of the ledger', async () => {
    const { rows, appended } = await anOpenLedger(onAFile);
    await Effect.runPromise(rows.keep(id, holding));
    await rows.close();
    const letGo = await heldUntilLetGo(appended, committed);

    const read = await Effect.runPromise(rows.read(id));
    await letGo();

    expect(read).toMatchObject({ holding: { ...holding } });
  });

  it('are refused, naming the file, before its ledger is open and once it is closed', async () => {
    const { file, named } = aLedgerFile(onAFile);
    const before = await Effect.runPromiseExit(file.secretRows);
    const { dispose } = await openConnectionWith(file.ledgerLayer());
    await dispose();

    const after = await Effect.runPromiseExit(file.secretRows);

    const refusal = `The secret rows of the ledger in ${named} run on the pool its ledger opens, and its ledger is not open`;
    expect([before, after]).toEqual([Exit.die(new LedgerNotOpen(refusal)), Exit.die(new LedgerNotOpen(refusal))]);
  });
});
