import { openRequests } from '@on.auto/interaction';
import { chatDelivery } from '@on.auto/interaction/testing';
import { projectedTableOf } from '@on.auto/operations';
import { describe, expect, it, onTestFinished } from 'vitest';

import { chatEnvironment, chatServer, deliveryHistoryOf } from '../testing/interaction-servers/chat-deliveries.ts';
import { interactionServerOn, servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { until } from '../testing/waiting/until.ts';

const aNumber: unknown = expect.any(Number);

async function dueNow(file: string): Promise<void> {
  await onTheLedgerIn(file, (connection) =>
    connection.write(everyRowSet(projectedTableOf(openRequests), { next_attempt_at: 0, attempt_due_at: 0 })),
  );
}

describe('a tool its operator disallowed after a request asked through it', () => {
  it('fails the next attempt as a tool no longer offered, and the request stays open, answered through the inbox', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const unreachable = await chatServer();
    await unreachable.close();
    const first = await servingInteractions(chatDelivery, {
      ...chatEnvironment(unreachable.url),
      LEDGER_FILE: ledger.fileName,
    });
    const runId = await first.ask('approve-brief');
    const unreached = await until(
      () => deliveryHistoryOf(first, runId),
      (seen) => seen.length >= 2,
    );
    await first.stop();
    await dueNow(ledger.fileName);

    const chat = await chatServer();
    const second = await interactionServerOn({
      ...chatEnvironment(chat.url, { allowed: ['echo'] }),
      LEDGER_FILE: ledger.fileName,
    });
    const facts = await until(
      () => deliveryHistoryOf(second, runId),
      (seen) => seen.length >= 4,
    );
    const answered = await second.answer(runId, { answer: { choice: 'approve' } });

    expect(unreached[1]).toEqual({
      type: 'delivery_failed',
      number: 1,
      because: 'server_failure',
      detail: 'The tool server chat could not be used: The tool server could not be reached',
      duration_ms: aNumber,
    });
    expect(facts.at(-1)).toMatchObject({
      type: 'delivery_failed',
      because: 'tool_not_offered',
      detail: 'The operator of this server does not allow chat/post_message',
    });
    expect(answered.status).toBe(200);
    expect(chat.received()).toEqual([]);
  });
});
