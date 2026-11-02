import { describe, expect, it } from 'vitest';

import { deliveryStarted } from '../facts/fact-words.ts';
import { routeOf, throughWords, toolsOf } from './routes.ts';

const chat = { server: 'chat', tool: 'post_message' };

const replies = {
  tool: 'thread_replies',
  with: {},
  read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
  tell: { tool: 'post_reply', with: {} },
} as const;

describe('the route of a request', () => {
  it('is held for an agent without a delivery, and else the tool and how replies are read', () => {
    expect([routeOf({}), routeOf({ deliver: { ...chat } }), routeOf({ deliver: chat, replies })]).toEqual([
      { kind: 'agent' },
      { kind: 'tool', delivery: chat },
      { kind: 'tool', delivery: chat, replies },
    ]);
  });

  it('names every tool it calls once, through the server it delivers through', () => {
    expect([
      toolsOf(routeOf({})),
      toolsOf(routeOf({ deliver: chat })),
      toolsOf(routeOf({ deliver: chat, replies })),
      toolsOf(routeOf({ deliver: chat, replies: { ...replies, tool: 'post_message', tell: { with: {} } } })),
    ]).toEqual([
      [],
      [chat],
      [chat, { server: 'chat', tool: 'thread_replies' }, { server: 'chat', tool: 'post_reply' }],
      [chat],
    ]);
  });

  it('is told in the same words by the capability and by the history of a delivery', () => {
    const through = throughWords(routeOf({ deliver: chat }));

    expect([through, throughWords(routeOf({}))]).toEqual([
      'through the post message tool of chat',
      'held for an agent',
    ]);
    expect(deliveryStarted({ type: 'delivery_started', data: { number: 1, target: 'ada', ...chat } })).toBe(
      `Delivery attempt 1 of the request started, ${through}.`,
    );
  });
});
