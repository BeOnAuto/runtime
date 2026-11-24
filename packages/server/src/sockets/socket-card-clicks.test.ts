import { clickDelivery, playbooksWaitingIn, replyAwaited } from '@on.auto/interaction';
import {
  actionOf,
  answererId,
  clickingIn,
  quietRowsDocument,
  recordsOf,
  rowsInputValue,
} from '@on.auto/interaction/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clickOf, sentOver, warnedOf } from '../testing/sockets/click-arrivals.ts';
import { statusesAnswering } from '../testing/sockets/replies-waiting.ts';
import { SocketsOverALedger } from '../testing/sockets/sockets-over-a-ledger.ts';
import type { SocketReplies } from './socket-replies.ts';

afterEach(() => {
  vi.useRealTimers();
});

async function cardWaiting() {
  const card = await clickingIn(quietRowsDocument, rowsInputValue, answererId);
  const ledger = card.playbook.ledger.service;
  const replies: SocketReplies = {
    waitingIn: playbooksWaitingIn({ ledger }),
    awaited: replyAwaited({ ledger }),
    delivered: () => Effect.die('a reply was delivered'),
    clicked: clickDelivery({ ledger, tools: card.playbook.chat, record: card.playbook.record }),
    tools: statusesAnswering().tools,
  };
  const server = new SocketsOverALedger();
  server.takesRepliesBy(replies);
  return { card, server };
}

describe('a click on a card with buttons and no replies, sent to a person in a direct message, over a socket', () => {
  it('is taken: its parts are kept, the card is drawn again and the request stays open', async () => {
    const { card, server } = await cardWaiting();
    const action = actionOf(card.shownFirst(), 'Approve', 0);

    await sentOver(server, [clickOf('T1', card.thread, { action, channel: answererId })], 'T1');

    expect(await recordsOf(card.playbook.ledger, 'answer_set')).toHaveLength(1);
    expect(await recordsOf(card.playbook.ledger, 'request_answered')).toEqual([]);
    expect(card.edits()).toHaveLength(1);
  });

  it('is logged with its org and connection alone where no request was sent as the message it is on', async () => {
    const { card, server } = await cardWaiting();
    const action = actionOf(card.shownFirst(), 'Approve', 0);
    const logged: string[] = [];

    await sentOver(server, [clickOf('T1', '1699.404', { action, channel: answererId })], 'T1', (line) => {
      logged.push(line);
    });

    expect(warnedOf(logged).filter((line) => line.includes('"reason":"no_request"'))).toHaveLength(1);
    expect(card.edits()).toEqual([]);
  });
});

describe('a click on a card with buttons and no replies over a socket, where nothing can take it', () => {
  it('is logged where no request waits in its conversation', async () => {
    const { card, server } = await cardWaiting();
    const logged: string[] = [];

    await sentOver(
      server,
      [clickOf('T1', card.thread, { action: 'auto-answer:1', channel: 'D0ELSEWHERE' })],
      'T1',
      (line) => {
        logged.push(line);
      },
    );

    expect(warnedOf(logged).filter((line) => line.includes('"reason":"nobody"'))).toHaveLength(1);
  });

  it('is logged where it is of another account than its connection', async () => {
    const { card, server } = await cardWaiting();
    const logged: string[] = [];

    await sentOver(
      server,
      [clickOf('T2', card.thread, { action: 'auto-answer:1', channel: answererId })],
      'T1',
      (line) => {
        logged.push(line);
      },
    );

    expect(warnedOf(logged).filter((line) => line.includes('"reason":"account"'))).toHaveLength(1);
  });
});
