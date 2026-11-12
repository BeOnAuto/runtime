import { describe, expect, it } from 'vitest';

import { chatConversations } from '../testing/index.ts';
import type { DeliverBlock, Replies } from '../tool-blocks/tool-block-schemas.ts';
import { resolvedTelling, tellingWrittenBefore } from './telling-routes.ts';

const deliver: DeliverBlock = {
  server: 'chat',
  tool: 'post_message',
  with: { channel: '{{ to }}', text: '{{ message }}' },
  sent: { conversation: '/channel', id: '/ts' },
};

const replies: Replies = {
  tool: 'thread_replies',
  with: { channel: '{{ sent.conversation }}', ts: '{{ sent.id }}' },
  read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
};

const ownLine = { with: { channel: '{{ sent.conversation }}', text: '{{ message }}' } };

const { reply, react, automatic = '' } = chatConversations;

describe('the telling a request is asked with', () => {
  it('is the provider’s word and tools where the function writes no tell, or a word, and nothing where it says none', () => {
    expect([
      resolvedTelling(deliver, replies, chatConversations),
      resolvedTelling(deliver, { ...replies, tell: 'refusals' }, chatConversations),
      resolvedTelling(deliver, { ...replies, tell: 'none' }, chatConversations),
    ]).toEqual([
      { when: 'all', line: reply, mark: react, automatic, tellsOthers: true },
      { when: 'refusals', line: reply, mark: react, automatic, tellsOthers: true },
      { when: 'none', automatic },
    ]);
  });

  it('keeps the function’s own line, with the delivery’s pointers for the delivering tool and none for another, and the provider’s mark and word', () => {
    expect([
      resolvedTelling(deliver, { ...replies, tell: ownLine }, chatConversations),
      resolvedTelling(deliver, { ...replies, tell: { ...ownLine, tool: 'post_reply', when: 'refusals' } }),
      resolvedTelling(deliver, { ...replies, tell: { ...ownLine, tool: 'post_reply', sent: '/id' } }),
    ]).toEqual([
      {
        when: 'all',
        line: { tool: 'post_message', ...ownLine, sent: '/ts', conversationAt: '/channel' },
        mark: react,
        automatic,
        tellsOthers: true,
      },
      { when: 'refusals', line: { tool: 'post_reply', ...ownLine } },
      { when: 'refusals', line: { tool: 'post_reply', ...ownLine, sent: '/id' } },
    ]);
  });

  it('has no way to tell where the provider says nothing, whatever word the function writes', () => {
    expect([resolvedTelling(deliver, replies), resolvedTelling(deliver, { ...replies, tell: 'all' })]).toEqual([
      { when: 'none' },
      { when: 'all' },
    ]);
  });
});

describe('the read limit a request keeps', () => {
  it('is the provider’s quota and window, whatever the function tells, and none where the provider declares none', () => {
    const limited = { ...chatConversations, read_limit: { quota: 1, window_seconds: 60 } };
    const readLimit = { quota: 1, windowSeconds: 60 };

    expect([
      resolvedTelling(deliver, replies, limited).readLimit,
      resolvedTelling(deliver, { ...replies, tell: 'none' }, limited).readLimit,
      resolvedTelling(deliver, { ...replies, tell: ownLine }, limited).readLimit,
      resolvedTelling(deliver, replies, chatConversations).readLimit,
      resolvedTelling(deliver, replies).readLimit,
    ]).toEqual([readLimit, readLimit, readLimit, undefined, undefined]);
  });
});

describe('the telling of a request asked before a request kept one', () => {
  it('is its own tell block for refusals alone, or nothing where it wrote none', () => {
    expect([
      tellingWrittenBefore({ ...replies, tell: ownLine }, deliver),
      tellingWrittenBefore(replies, deliver),
    ]).toEqual([
      { when: 'refusals', line: { tool: 'post_message', ...ownLine, sent: '/ts', conversationAt: '/channel' } },
      { when: 'none' },
    ]);
  });
});
