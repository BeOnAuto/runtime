import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { chatConversations } from '../testing/chat-conversations.ts';
import { answererId } from '../testing/chat-harness.ts';
import { askedRun, deliveringTo, type Delivering } from '../testing/delivered-conversations.ts';
import { chatDelivery, notificationDocument, threadDocument, threadRepliesTelling } from '../testing/documents.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { theChannel } from '../testing/woken-conversations.ts';
import { replyAwaited, type PlaceOfTheReplies } from './named-requests.ts';

const anotherRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const someoneElse = 'U0SOMEONEELSE';

const ofTheRequest: PlaceOfTheReplies = { playbook: alpha, connection: 'chat', conversation: theChannel };

interface Replied {
  readonly id?: string;
  readonly sender?: string;
  readonly to: string;
}

function awaitedIn(delivering: Delivering, replied: Replied, place: Partial<PlaceOfTheReplies> = {}) {
  const reply = { id: '1700000000.000900', sender: answererId, ...replied };
  return Effect.runPromise(
    replyAwaited({ ledger: delivering.playbook.ledger.service })({ ...ofTheRequest, ...place }, reply),
  );
}

describe('whether a reply to a message is awaited', () => {
  it('is, where a request of the playbook was sent as that message in that conversation through that connection and takes replies', async () => {
    const delivering = await deliveringTo();

    expect(await awaitedIn(delivering, { to: delivering.thread })).toMatchObject({ awaited: true });
  });

  it('is not, for another message, connection, conversation or playbook', async () => {
    const delivering = await deliveringTo();
    const notAwaited = { awaited: false, typing: false };

    expect([
      await awaitedIn(delivering, { to: '1699.999999' }),
      await awaitedIn(delivering, { to: delivering.thread }, { connection: 'mail' }),
      await awaitedIn(delivering, { to: delivering.thread }, { conversation: '#approvals-marketing' }),
      await awaitedIn(delivering, { to: delivering.thread }, { playbook: { org: 'umbrella', playbook: 'alpha' } }),
    ]).toEqual([notAwaited, notAwaited, notAwaited, notAwaited]);
  });

  it('is, once the request was answered by a reply, so a later reply is told it was already answered', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('approve')]);

    expect(await awaitedIn(delivering, { to: delivering.thread })).toMatchObject({ awaited: true });
  });

  it('is not, once the request was answered in Auto, nor for the message of a request that reads no replies', async () => {
    const delivering = await deliveringTo();
    await delivering.playbook.call(answerInteraction, { run_id: askedRun, answer: { choice: 'reject' } });
    await delivering.playbook.define('announce-brief', notificationDocument(chatDelivery));
    await delivering.playbook.ask('announce-brief', { owner: 'sales', campaign: 'Spring' }, anotherRun);
    await delivering.playbook.performDue(Date.now());

    expect([
      await awaitedIn(delivering, { to: delivering.thread }),
      await awaitedIn(delivering, { to: delivering.lastPosted() }),
    ]).toEqual([
      { awaited: false, typing: false },
      { awaited: false, typing: false },
    ]);
  });
});

describe('whether the typing indicator is shown for a reply', () => {
  it('is, for the answerer’s reply to a request that still takes replies and tells a line for a reply taken and for one refused', async () => {
    const delivering = await deliveringTo();

    expect(await awaitedIn(delivering, { to: delivering.thread })).toEqual({ awaited: true, typing: true });
  });

  it('is not, for a reply of anyone else, which may be told nothing', async () => {
    const delivering = await deliveringTo();

    expect(await awaitedIn(delivering, { sender: someoneElse, to: delivering.thread })).toEqual({
      awaited: true,
      typing: false,
    });
  });

  it('is not, for a reply the run refused already, which is passed over and told nothing, while a new reply of the answerer is', async () => {
    const delivering = await deliveringTo();
    const maybe = delivering.written('maybe');
    await delivering.delivered([maybe]);

    expect([
      await awaitedIn(delivering, { id: maybe.id, to: delivering.thread }),
      await awaitedIn(delivering, { id: '1700000000.000901', to: delivering.thread }),
    ]).toEqual([
      { awaited: true, typing: false },
      { awaited: true, typing: true },
    ]);
  });

  it('is not, once the request was answered by a reply, since no request waits for the answerer any more', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('approve')]);

    expect(await awaitedIn(delivering, { to: delivering.thread })).toEqual({ awaited: true, typing: false });
  });

  it('is not, where the function tells refusals alone, since a reply taken is told nothing', async () => {
    const delivering = await deliveringTo({
      conversations: chatConversations,
      document: threadDocument({ replies: threadRepliesTelling('  tell: refusals') }),
    });

    expect(await awaitedIn(delivering, { to: delivering.thread })).toEqual({ awaited: true, typing: false });
  });
});
