import { describe, expect, it } from 'vitest';

import { answererId, chatHarness, farAhead, threadDocument, type ChatHarness } from '../testing/index.ts';
import {
  flatNamingReplies,
  threadNamingNoMessageReplies,
  threadOfTheChannelReplies,
} from '../testing/reading-documents.ts';

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
