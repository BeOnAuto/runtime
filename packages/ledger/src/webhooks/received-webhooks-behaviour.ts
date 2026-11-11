import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { layoutIn } from '../layout/ledger-layout-behaviour.ts';
import { ledgerLayout } from '../layout/ledger-layout.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import type { ReceivedWebhooks, WebhookReceipt } from './received-webhooks.ts';

export interface ReceivedWebhooksEntry extends LedgerEntry {
  readonly receivedWebhooksOn: (database: string) => Effect.Effect<ReceivedWebhooks>;
}

const aMinute = 60_000;

function receiptOf(takenFor: string, changes: Partial<WebhookReceipt> = {}): WebhookReceipt {
  return {
    org: 'acme',
    connection: 'approvals',
    webhookId: 'msg_2Lh9KRb1t3',
    takenFor,
    keptUntilMs: Date.now() + 10 * aMinute,
    ...changes,
  };
}

async function receivedOn(entry: ReceivedWebhooksEntry): Promise<ReceivedWebhooks> {
  const database = await entry.aDatabase();
  await aLedger(entry, database);
  const received = await Effect.runPromise(entry.receivedWebhooksOn(database));
  onTestFinished(() => received.close());
  return received;
}

function takenEach(received: ReceivedWebhooks, receipts: readonly WebhookReceipt[]): Promise<readonly string[]> {
  return Effect.runPromise(Effect.forEach(receipts, (receipt) => received.taken(receipt)));
}

function takenOnce(entry: ReceivedWebhooksEntry): void {
  describe('the webhooks it received', () => {
    it('keep an id for whatever took it first, so the same id for another holder answers the first', async () => {
      const received = await receivedOn(entry);

      expect(
        await takenEach(received, [
          receiptOf('alpha/run-1'),
          receiptOf('alpha/run-1'),
          receiptOf('alpha/run-2'),
          receiptOf('beta/run-3'),
        ]),
      ).toEqual(['alpha/run-1', 'alpha/run-1', 'alpha/run-1', 'alpha/run-1']);
    });

    it('keep an id apart for each connection and each org', async () => {
      const received = await receivedOn(entry);

      expect(
        await takenEach(received, [
          receiptOf('alpha/run-1'),
          receiptOf('alpha/run-2', { connection: 'tickets' }),
          receiptOf('alpha/run-3', { org: 'globex' }),
          receiptOf('alpha/run-4', { webhookId: 'msg_other' }),
        ]),
      ).toEqual(['alpha/run-1', 'alpha/run-2', 'alpha/run-3', 'alpha/run-4']);
    });
  });
}

function keptInTheLayout(entry: ReceivedWebhooksEntry): void {
  describe('the webhooks it received, as time passes and as they are kept', () => {
    it('forget an id once the time it is kept until has passed, so another may take it', async () => {
      const received = await receivedOn(entry);

      expect(
        await takenEach(received, [
          receiptOf('alpha/run-1', { keptUntilMs: Date.now() - 1 }),
          receiptOf('alpha/run-2'),
        ]),
      ).toEqual(['alpha/run-1', 'alpha/run-2']);
    });

    it('are kept in a table of the layout, on the database the ledger made', async () => {
      const database = await entry.aDatabase();
      await aLedger(entry, database);

      const received = await Effect.runPromise(entry.receivedWebhooksOn(database));
      onTestFinished(() => received.close());

      expect(await Effect.runPromise(received.taken(receiptOf('alpha/run-1')))).toBe('alpha/run-1');
      expect((await layoutIn(entry, database)).layout).toBe(ledgerLayout);
      expect(
        await entry.queried(database, 'SELECT org, connection, webhook_id, taken_for FROM webhooks_received'),
      ).toEqual([{ org: 'acme', connection: 'approvals', webhook_id: 'msg_2Lh9KRb1t3', taken_for: 'alpha/run-1' }]);
    });
  });
}

export function receivedWebhooksBehaviour(entry: ReceivedWebhooksEntry): void {
  takenOnce(entry);
  keptInTheLayout(entry);
}
