import type { ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  answered,
  answeredInAFile,
  answererId,
  chatConversations,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';
import type { DeliverBlock, Replies } from '../tool-blocks/tool-block-schemas.ts';
import { resolvedTelling, tellingWrittenBefore } from './telling-routes.ts';
import { tellings } from './telling-rows.ts';

const ended = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const channel = '#approvals-sales';

describe('the message of a request that has ended', () => {
  it('is never read as a reply in a chat without threads whose connection posts as the person who answers', async () => {
    const playbook = await chatHarness({ postsAs: answererId, document: threadDocument({ replies: flatReplies }) });
    await playbook.askInThread(ended);
    await playbook.performDue(Date.now());
    await playbook.call(answerInteraction, { run_id: ended, answer: { choice: 'approve' } });
    await playbook.performDue(Date.now());
    await playbook.askInThread(waiting);
    await playbook.performDue(Date.now());

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toMatchObject([
      { type: 'request_answered', context: { runId: ended } },
    ]);
    expect(playbook.chat.posted()).toHaveLength(2);
  });
});

describe('a telling whose answer names the message it posted but not its conversation', () => {
  it('is the last its request makes, since the playbook cannot know where it landed', async () => {
    const playbook = await chatHarness({ postsAs: answererId, document: threadDocument({ replies: flatReplies }) });
    await playbook.askInThread(ended);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'maybe' });
    playbook.chat.answerNext(
      answered({ messages: [{ ts: '1699.000002', channel, user: answererId, text: 'maybe' }] }),
      answered({ ok: true, ts: '1699.000003' }),
    );
    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.reply({ channel, user: answererId, text: 'later' });

    await playbook.performReads(Date.now() + 2 * farAhead);

    expect((await recordsOf(playbook.ledger, 'reply_refused')).map(({ data }) => data)).toMatchObject([
      { told: true },
      { told: false },
    ]);
  });
});

describe('a telling whose tool answered where its message landed in a file', () => {
  it('knows the message it posted from the text of the file', async () => {
    const playbook = await chatHarness({ postsAs: answererId, document: threadDocument({ replies: flatReplies }) });
    await playbook.askInThread(ended);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'maybe' });
    playbook.chat.answerNext(
      answered({ messages: [{ ts: '1699.000002', channel, user: answererId, text: 'maybe' }] }),
      answeredInAFile({ ok: true, channel, ts: '1699.000003' }),
    );

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'telling_succeeded')).toMatchObject([
      { data: { told_as: { conversation: channel, id: '1699.000003' } } },
    ]);
  });
});

const context = {
  at: '2026-11-10T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'interaction',
  definitionName: 'approve-brief',
  definitionVersion: 1,
};

const answeredFields = { result_bytes: 64, result_sha256: 'd'.repeat(64), duration_ms: 3, jsonrpc_id: 2 };

function messageOf(type: string, data: unknown): ProjectedMessage {
  return { id: `${type}-1`, position: 1, type, data, context };
}

const succeeded = messageOf('telling_succeeded', {
  call_id: 'call-1',
  ...answeredFields,
  told_as: { conversation: '#approvals-sales', id: '1699.000003' },
});

describe('the row of a telling', () => {
  it('is made by its start and knows the message its end names', () => {
    const started = tellings.rowAfter(
      undefined,
      messageOf('telling_started', { call_id: 'call-1', server: 'chat', tool: 'post_message', arguments_bytes: 80 }),
    );

    expect([started, tellings.rowAfter(started, succeeded)]).toEqual([
      { run_id: context.runId, conversation: null, message: null, known: false },
      { run_id: context.runId, conversation: '#approvals-sales', message: '1699.000003', known: true },
    ]);
  });

  it('is changed by no end whose start it did not see, and by no fact but a telling', () => {
    const read = messageOf('replies_read', {
      call_id: 'call-2',
      server: 'chat',
      tool: 'thread_replies',
      conversation: '#approvals-sales',
      since: null,
      ...answeredFields,
      replies: 1,
      taken: 0,
      refused: 0,
    });

    expect([tellings.rowAfter(undefined, succeeded), tellings.rowAfter(undefined, read)]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

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
