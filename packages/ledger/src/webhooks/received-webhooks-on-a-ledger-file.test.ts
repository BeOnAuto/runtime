import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  aLedgerFile,
  anOpenLedger,
  committed,
  exitOf,
  heldUntilLetGo,
  onAFile,
  places,
  rolledBack,
} from '../secrets/held-ledger-file.ts';
import { LedgerNotOpen } from '../secrets/sqlite-ledger-file.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import type { WebhookReceipt } from './received-webhooks.ts';

const longerThanSQLiteWaitsForItsLock = 5_500;

const tenMinutes = 600_000;

const longEnoughForAStatementToRun = 100;

function receiptFor(takenFor: string): WebhookReceipt {
  return {
    org: 'acme',
    connection: 'approvals',
    webhookId: 'msg_2Lh9KRb1t3',
    takenFor,
    keptUntilMs: Date.now() + tenMinutes,
  };
}

describe('the webhooks received of a ledger file on SQLite, as they are taken', () => {
  it(
    'take an id while the writer of the ledger holds the file past the 5 s a statement waits for its lock, once it lets go',
    { timeout: 20_000 },
    async () => {
      const { received, appended } = await anOpenLedger(onAFile);
      const letGo = await heldUntilLetGo(appended, committed);

      const taken = Effect.runPromiseExit(received.taken(receiptFor('onboarding/run-1')));
      await Effect.runPromise(Effect.sleep(longerThanSQLiteWaitsForItsLock));
      await letGo();

      expect(await taken).toEqual(Exit.succeed('onboarding/run-1'));
    },
  );

  it('keep an id taken while a transaction of the ledger is open, though that transaction is rolled back', async () => {
    const { received, appended } = await anOpenLedger(onAFile);
    const letGo = await heldUntilLetGo(appended, rolledBack);

    const taking = Effect.runPromiseExit(received.taken(receiptFor('onboarding/run-1')));
    const transaction = await letGo();
    const taken = await taking;
    const takenAgain = await Effect.runPromise(received.taken(receiptFor('onboarding/run-2')));

    expect([Exit.isFailure(transaction), taken, takenAgain]).toEqual([
      true,
      Exit.succeed('onboarding/run-1'),
      'onboarding/run-1',
    ]);
  });

  it('are refused, naming the file, before its ledger is open and once it is closed', async () => {
    const { file, named } = aLedgerFile(onAFile);
    const before = await Effect.runPromiseExit(file.receivedWebhooks);
    const { dispose } = await openConnectionWith(file.ledgerLayer());
    await dispose();

    const after = await Effect.runPromiseExit(file.receivedWebhooks);

    const refusal = `The webhooks received of the ledger in ${named} run on the pool its ledger opens, and its ledger is not open`;
    expect([before, after]).toEqual([Exit.die(new LedgerNotOpen(refusal)), Exit.die(new LedgerNotOpen(refusal))]);
  });
});

describe.each(places)(
  'the webhooks received of a ledger on SQLite, on $place, taken inside a transaction of the ledger',
  (place) => {
    it('keep an id whose take is started inside a transaction of the ledger, once it ends, though it is rolled back', async () => {
      const { received, appended } = await anOpenLedger(place);
      const order: string[] = [];
      const take = Promise.withResolvers<Exit.Exit<string>>();
      const settles = Effect.sync(() => order.push('the take settles'));

      const transaction = await exitOf(
        appended(async () => {
          take.resolve(Effect.runPromiseExit(Effect.ensuring(received.taken(receiptFor('onboarding/run-1')), settles)));
          await Effect.runPromise(Effect.sleep(longEnoughForAStatementToRun));
          await rolledBack();
        }).finally(() => {
          order.push('the transaction ends');
        }),
      );
      const taken = await take.promise;
      const takenAgain = await Effect.runPromise(received.taken(receiptFor('onboarding/run-2')));

      expect([Exit.isFailure(transaction), taken, takenAgain]).toEqual([
        true,
        Exit.succeed('onboarding/run-1'),
        'onboarding/run-1',
      ]);
      expect(order).toEqual(['the transaction ends', 'the take settles']);
    });
  },
);
