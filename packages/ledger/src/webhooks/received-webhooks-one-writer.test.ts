import { SQL } from '@event-driven-io/dumbo';
import { Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import { inTransactionOf, type ReturningExecutor, type TransactionalPool } from '../event-store.ts';
import { pooledOptionsOf, sqliteEventStore } from '../sqlite-event-store.ts';
import { modestConnections } from '../sqlite.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { receivedWebhooksOn, type WebhookReceipt } from './received-webhooks.ts';

const waitingForNoLock = { pragmaOptions: { ...modestConnections.pragmaOptions, busy_timeout: 0 } };

const tenMinutes = 600_000;

async function aPoolWhoseConnectionsWaitForNoLock(): Promise<TransactionalPool<ReturningExecutor>> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const options = pooledOptionsOf(() => ({
    driver: nodeSqliteEventStoreDriver,
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
  readonly heldAndAskedAgain: Promise<void>;
  readonly letGo: () => Promise<void>;
}

function aTransactionBeginningAfterTheFirstWrite(pool: TransactionalPool<ReturningExecutor>): ATransactionBetween {
  const begun = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
  const askedAgain = Promise.withResolvers<void>();
  const transaction: { held?: Promise<void> } = {};
  return {
    heldAndAskedAgain: askedAgain.promise,
    execute: {
      query: (sql) => pool.execute.query(sql),
      command: async (sql) => {
        if (transaction.held !== undefined) {
          askedAgain.resolve();
        }
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

    const settling = { settled: false };
    const taking = Effect.runPromiseExit(received.taken(receiptOf('msg_2Lh9KRb1t3', 'onboarding/run-1'))).finally(
      () => {
        settling.settled = true;
      },
    );
    await between.heldAndAskedAgain;
    const keptWhileHeld = (await pool.execute.query(SQL`SELECT webhook_id FROM webhooks_received`)).rows;
    const settledWhileHeld = settling.settled;
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

    expect([keptWhileHeld, settledWhileHeld]).toEqual([[], false]);
    expect(taken).toEqual(Exit.succeed('onboarding/run-1'));
    expect(takenAgain).toEqual(['onboarding/run-1', 'onboarding/run-1', 'onboarding/run-2']);
    expect(rows).toEqual([
      { webhook_id: 'msg_2Lh9KRb1t3', taken_for: 'onboarding/run-1' },
      { webhook_id: 'msg_3Mk0LSc2u4', taken_for: 'onboarding/run-2' },
    ]);
  });
});
