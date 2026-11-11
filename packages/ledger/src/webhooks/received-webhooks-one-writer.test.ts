import { SQL } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { inTransactionOf, type ReturningExecutor, type TransactionalPool } from '../event-store.ts';
import { pooledOptionsOf, sqliteEventStore } from '../sqlite-event-store.ts';
import { modestConnections } from '../sqlite3.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { receivedWebhooksOn, type WebhookReceipt } from './received-webhooks.ts';

const longerThanAWriteTakesToReachSQLite = 250;

const waitingForNoLock = { pragmaOptions: { ...modestConnections.pragmaOptions, busy_timeout: 0 } };

const tenMinutes = 600_000;

async function aPoolWhoseConnectionsWaitForNoLock(): Promise<TransactionalPool<ReturningExecutor>> {
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
  return options.pool;
}

interface ATransactionBetween {
  readonly execute: ReturningExecutor;
  readonly letGo: () => Promise<void>;
}

function aTransactionBeginningAfterTheFirstWrite(pool: TransactionalPool<ReturningExecutor>): ATransactionBetween {
  const begun = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
  const transaction: { held?: Promise<void> } = {};
  return {
    execute: {
      query: (sql) => pool.execute.query(sql),
      command: async (sql) => {
        const answered = await pool.execute.command(sql);
        transaction.held ??= inTransactionOf(pool)(async () => {
          begun.resolve();
          await letGo.promise;
        });
        await begun.promise;
        return answered;
      },
    },
    letGo: async () => {
      letGo.resolve();
      await transaction.held;
    },
  };
}

function receiptOf(webhookId: string, takenFor: string): WebhookReceipt {
  return { org: 'acme', connection: 'approvals', webhookId, takenFor, keptUntilMs: Date.now() + tenMinutes };
}

describe('a take of the webhooks received on SQLite, while the one writer of their pool is in a transaction', () => {
  it('takes an id once a transaction that began between its two statements ends, and takes each id once', async () => {
    const pool = await aPoolWhoseConnectionsWaitForNoLock();
    const between = aTransactionBeginningAfterTheFirstWrite(pool);
    const received = receivedWebhooksOn(between.execute, () => Promise.resolve());

    const taking = Effect.runPromiseExit(received.taken(receiptOf('msg_2Lh9KRb1t3', 'onboarding/run-1')));
    await Promise.race([taking, Effect.runPromise(Effect.sleep(longerThanAWriteTakesToReachSQLite))]);
    await between.letGo();
    const taken = await taking;
    const takenAgain = await Effect.runPromise(
      Effect.forEach(
        [
          receiptOf('msg_2Lh9KRb1t3', 'onboarding/run-2'),
          receiptOf('msg_2Lh9KRb1t3', 'onboarding/run-1'),
          receiptOf('msg_3Mk0LSc2u4', 'onboarding/run-2'),
        ],
        (receipt) => received.taken(receipt),
      ),
    );
    const { rows } = await pool.execute.query(
      SQL`SELECT webhook_id, taken_for FROM webhooks_received ORDER BY webhook_id`,
    );

    expect(taken).toEqual(Exit.succeed('onboarding/run-1'));
    expect(takenAgain).toEqual(['onboarding/run-1', 'onboarding/run-1', 'onboarding/run-2']);
    expect(rows).toEqual([
      { webhook_id: 'msg_2Lh9KRb1t3', taken_for: 'onboarding/run-1' },
      { webhook_id: 'msg_3Mk0LSc2u4', taken_for: 'onboarding/run-2' },
    ]);
  });
});
