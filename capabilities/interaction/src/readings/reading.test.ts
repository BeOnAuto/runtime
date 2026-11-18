import type { ProjectedMessage } from '@on.auto/operations';
import { streamAddressed } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { answererId, chatHarness, type ChatHarness, farAhead, threadDocument } from '../testing/index.ts';
import {
  flatNamingReplies,
  threadNamingNoMessageReplies,
  threadOfTheChannelReplies,
} from '../testing/reading-documents.ts';
import { readings } from './reading-rows.ts';

const stream = streamAddressed('definition/acme/d1/conversation-calls/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70');

const reading = 'f'.repeat(64);

function readOf(type: string, extra: object, id = 'fact-1'): ProjectedMessage {
  const data = {
    call_id: stream.id,
    server: 'chat',
    tool: 'thread_replies',
    conversation: '#approvals-sales',
    since: '1699.4',
    ...extra,
  };
  return { id, position: 1, type, data, context: { by: 'playbook:alpha', at: '2026-10-01T09:00:10.000Z' } };
}

const found = {
  arguments_bytes: 34,
  result_bytes: 120,
  jsonrpc_id: 2,
  duration_ms: 12,
  replies: 1,
  taken: 0,
  refused: 0,
};

describe('the readings projection', () => {
  it('keeps the cursor of a reading of a conversation from each read of it, found or failed, keyed by the conversation and the reading', () => {
    const repliesRead = readOf('replies_read', { ...found, reading });
    const failed = readOf('reading_failed', { reading, since: '1699.4', because: 'timed_out' }, 'fact-2');

    expect([readings.keyOf?.(repliesRead, stream), readings.rowAfter(undefined, repliesRead)]).toEqual([
      `chat/thread_replies/#approvals-sales/${reading}`,
      {
        server: 'chat',
        tool: 'thread_replies',
        conversation: '#approvals-sales',
        reading,
        since: '1699.4',
        last_fact: 'fact-1',
      },
    ]);
    expect(readings.rowAfter(readings.rowAfter(undefined, repliesRead), failed)).toMatchObject({
      since: '1699.4',
      last_fact: 'fact-2',
    });
  });

  it('keeps nothing of a read recorded before readings were, whose cursor is its conversation’s', () => {
    const before = readOf('replies_read', found);

    expect([readings.keyOf?.(before, stream), readings.rowAfter(undefined, before)]).toEqual([undefined, undefined]);
  });
});

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const flatAfter = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73';

const channel = '#approvals-sales';

function readsMade(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => [input['ts'] ?? 'the channel', input['oldest']]);
}

function postedTs(playbook: ChatHarness): readonly string[] {
  return playbook.chat.posted().map(({ ts }) => ts);
}

describe('a read that names its request’s message, whose replies name no message', () => {
  it('is read from the start of its own thread and on from a cursor of its own, not from where the conversation was', async () => {
    const playbook = await chatHarness({ document: threadDocument({ replies: threadNamingNoMessageReplies }) });
    await playbook.askInThread(older);
    await playbook.performDue(Date.now());
    const [olderThread = ''] = postedTs(playbook);
    playbook.chat.reply({ channel, thread: olderThread, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());
    await playbook.askInThread(newer);
    await playbook.performDue(Date.now());
    const [, newerThread = ''] = postedTs(playbook);
    playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'reject' });

    await playbook.performReads(Date.now() + 2 * farAhead);
    await playbook.performDue(Date.now());

    expect(readsMade(playbook)).toEqual([
      [olderThread, '0'],
      [newerThread, '0'],
    ]);
    expect([await playbook.runOf(older), await playbook.runOf(newer)]).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
    ]);
  });
});

describe('a thread’s read and a flat read whose replies may name their message, in one conversation', () => {
  it('reads the thread from its own start and the channel on from where the conversation was, so an earlier answer answers no later request', async () => {
    const playbook = await chatHarness({ document: threadDocument({ replies: threadOfTheChannelReplies }) });
    await playbook.define('approve-plan', threadDocument({ replies: flatNamingReplies }));
    const plan = { team: 'sales', owner: answererId, campaign: 'Autumn' };
    await playbook.ask('approve-plan', plan, older);
    await playbook.performDue(Date.now());
    const answeredBefore = playbook.chat.reply({ channel, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());
    await playbook.askInThread(newer);
    await playbook.ask('approve-plan', plan, flatAfter);
    await playbook.performDue(Date.now());
    const [, thread = ''] = postedTs(playbook);
    const answeredInTheThread = playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + 2 * farAhead);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'reject' });

    await playbook.performReads(Date.now() + 3 * farAhead);
    await playbook.performDue(Date.now());

    expect(readsMade(playbook)).toEqual([
      ['the channel', '0'],
      [thread, '0'],
      ['the channel', answeredBefore],
      ['the channel', answeredInTheThread],
    ]);
    expect(await Promise.all([older, newer, flatAfter].map((runId) => playbook.runOf(runId)))).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
    ]);
  });
});
