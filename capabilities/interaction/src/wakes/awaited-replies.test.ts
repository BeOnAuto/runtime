import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { askedRun, deliveringTo, type Delivering } from '../testing/delivered-conversations.ts';
import { chatDelivery, notificationDocument } from '../testing/documents.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { theChannel } from '../testing/woken-conversations.ts';
import { replyAwaited, type PlaceOfTheReplies } from './named-requests.ts';

const anotherRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const ofTheRequest: PlaceOfTheReplies = { playbook: alpha, connection: 'chat', conversation: theChannel };

function awaitedIn(delivering: Delivering, to: string, place: Partial<PlaceOfTheReplies> = {}) {
  return Effect.runPromise(
    replyAwaited({ ledger: delivering.playbook.ledger.service })({ ...ofTheRequest, ...place }, to),
  );
}

describe('whether a reply to a message is awaited', () => {
  it('is, where a request of the playbook was sent as that message in that conversation through that connection and takes replies', async () => {
    const delivering = await deliveringTo();

    expect(await awaitedIn(delivering, delivering.thread)).toBe(true);
  });

  it('is not, for another message, connection, conversation or playbook', async () => {
    const delivering = await deliveringTo();

    expect([
      await awaitedIn(delivering, '1699.999999'),
      await awaitedIn(delivering, delivering.thread, { connection: 'mail' }),
      await awaitedIn(delivering, delivering.thread, { conversation: '#approvals-marketing' }),
      await awaitedIn(delivering, delivering.thread, { playbook: { org: 'umbrella', playbook: 'alpha' } }),
    ]).toEqual([false, false, false, false]);
  });

  it('is, once the request was answered by a reply, so a later reply is told it was already answered', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('approve')]);

    expect(await awaitedIn(delivering, delivering.thread)).toBe(true);
  });

  it('is not, once the request was answered in Auto, nor for the message of a request that reads no replies', async () => {
    const delivering = await deliveringTo();
    await delivering.playbook.call(answerInteraction, { run_id: askedRun, answer: { choice: 'reject' } });
    await delivering.playbook.define('announce-brief', notificationDocument(chatDelivery));
    await delivering.playbook.ask('announce-brief', { owner: 'sales', campaign: 'Spring' }, anotherRun);
    await delivering.playbook.performDue(Date.now());

    expect([
      await awaitedIn(delivering, delivering.thread),
      await awaitedIn(delivering, delivering.lastPosted()),
    ]).toEqual([false, false]);
  });
});
