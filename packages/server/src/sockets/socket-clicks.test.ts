import type { ClickDelivery, DeliveredClicks } from '@on.auto/interaction';
import { answererId, theChannel } from '@on.auto/interaction/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clickOf, conversationsWoken, sentOver, warnedOf } from '../testing/sockets/click-arrivals.ts';
import { repliesWaiting, T0 } from '../testing/sockets/replies-waiting.ts';
import { SocketsOverALedger } from '../testing/sockets/sockets-over-a-ledger.ts';
import type { SocketReplies } from './socket-replies.ts';

afterEach(() => {
  vi.useRealTimers();
});

interface Clicking {
  readonly server: SocketsOverALedger;
  readonly clicks: DeliveredClicks[];
  readonly thread: string;
}

async function clickingOn(clicked?: ClickDelivery): Promise<Clicking> {
  const waiting = await repliesWaiting();
  const clicks: DeliveredClicks[] = [];
  const recording: ClickDelivery = (delivered) => {
    clicks.push(delivered);
    return Effect.succeed([]);
  };
  const server = new SocketsOverALedger();
  const replies: SocketReplies = { ...waiting.replies, clicked: clicked ?? recording };
  server.takesRepliesBy(replies);
  return { server, clicks, thread: waiting.thread };
}

describe('a click that arrives over a socket', () => {
  it('is handed to each playbook with a request waiting in its conversation, as the click of the message it names', async () => {
    const { server, clicks, thread } = await clickingOn();

    await sentOver(server, [clickOf('T1', thread)], 'T1');

    expect(clicks).toMatchObject([
      {
        connection: 'chat',
        conversation: theChannel,
        clicks: [{ id: '1699.5', sender: answererId, to: thread, action: 'auto-answer:1a2b', time: 1699.5 * 1000 }],
      },
    ]);
    expect(conversationsWoken(server)).toEqual([]);
  });

  it('is taken as written when it arrived where its time is not one', async () => {
    const { server, clicks, thread } = await clickingOn();

    await sentOver(server, [clickOf('T1', thread, { time: 'a click' })], 'T1');

    expect(clicks).toMatchObject([{ clicks: [{ id: 'a click', time: T0 + 60_000 }] }]);
  });

  it('through a connection of another workspace is handed to nobody', async () => {
    const { server, clicks, thread } = await clickingOn();

    await sentOver(server, [clickOf('T2', thread)], 'T1');

    expect(clicks).toEqual([]);
  });

  it.each<[string, ClickDelivery]>([
    ['cannot be taken', () => Effect.die(new Error('the ledger is down'))],
    ['could not be recorded', () => Effect.succeed([{ id: '1699.5', outcome: 'unrecorded' }])],
  ])('that %s is acknowledged, and logged once with its org and connection', async (_, clicked) => {
    const { server, thread } = await clickingOn(clicked);
    const logged: string[] = [];

    await sentOver(server, [clickOf('T1', thread)], 'T1', (line) => {
      logged.push(line);
    });

    expect(warnedOf(logged)).toHaveLength(1);
  });
});
