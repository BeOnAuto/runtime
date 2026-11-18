import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  answered,
  answererId,
  chatHarness,
  type ChatHarness,
  type FakeAnswer,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { flatNamingReplies, flatReplies } from '../testing/reading-documents.ts';

const answeredFirst = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const askedAfter = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const shapes = [
  { shape: 'whose replies name no message', replies: flatReplies },
  { shape: 'whose replies may name their message in read.each.to', replies: flatNamingReplies },
] as const;

function readingMore(replies: readonly string[]): string {
  return threadDocument({ replies: replies.map((line) => (line === '  read:' ? '    limit: 20\n  read:' : line)) });
}

describe('a conversation whose read names no message, read by another call once an earlier request was answered in it', () => {
  it.each(shapes)(
    'is read on from where the conversation was, $shape, so the reply that answered the earlier request answers no later one',
    async ({ replies }) => {
      const playbook = await chatHarness({ document: threadDocument({ replies }) });
      await playbook.define('approve-plan', readingMore(replies));
      await playbook.askInThread(answeredFirst);
      await playbook.performDue(Date.now());
      playbook.chat.reply({ channel, user: answererId, text: 'approve' });
      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());
      await playbook.ask('approve-plan', { team: 'sales', owner: answererId, campaign: 'Autumn' }, askedAfter);
      await playbook.performDue(Date.now());

      await playbook.performReads(Date.now() + 2 * farAhead);
      await playbook.performDue(Date.now());
      const beforeItsReply = await playbook.runOf(askedAfter);
      playbook.chat.reply({ channel, user: answererId, text: 'reject' });
      await playbook.performReads(Date.now() + 3 * farAhead);
      await playbook.performDue(Date.now());

      expect(playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies')).toMatchObject([
        { input: { oldest: '0' } },
        { input: { oldest: '1699.000002', limit: 20 } },
        { input: { oldest: '1699.000002', limit: 20 } },
      ]);
      expect([beforeItsReply, await playbook.runOf(answeredFirst), await playbook.runOf(askedAfter)]).toMatchObject([
        { output: { status: 'started' } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'succeeded', output: { choice: 'reject' } } },
      ]);
    },
  );
});

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const keyedByTheChannel = threadDocument({
  replies: threadReplies.filter((line) => !line.startsWith('  conversation:')),
});

function threadsRead(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => [input['ts'], input['oldest']]);
}

const failures: readonly FakeAnswer[] = [
  { outcome: 'timed_out', detail: 'The tool server did not answer within 30000 ms', retryAfterMs: null },
  { outcome: 'server_failure', detail: 'The tool server answered HTTP 429', retryAfterMs: 60_000 },
];

describe('the newer of two threads, once the older request is answered past the newer reply', () => {
  it.each(failures)(
    'is read from its own start, so its earlier approve is taken, after its first read ended $outcome',
    async (failure) => {
      const playbook = await chatHarness({ document: keyedByTheChannel });
      await playbook.askInThread(older);
      await playbook.askInThread(newer);
      await playbook.performDue(Date.now());
      const [olderThread = '', newerThread = ''] = playbook.chat.posted().map(({ ts }) => ts);
      const newerReply = playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'approve' });
      const olderReply = playbook.chat.reply({ channel, thread: olderThread, user: answererId, text: 'approve' });
      playbook.chat.answerNext(
        answered({
          messages: [
            { ts: olderThread, channel, user: 'playbook', text: 'ask' },
            { ts: olderReply, channel, user: answererId, text: 'approve', thread_ts: olderThread },
          ],
        }),
        failure,
      );

      await playbook.performReads(Date.now() + farAhead);
      await playbook.performDue(Date.now());
      await playbook.performReads(Date.now() + 2 * farAhead);
      await playbook.performDue(Date.now());

      expect(newerReply < olderReply).toBe(true);
      expect(threadsRead(playbook)).toEqual([
        [olderThread, '0'],
        [newerThread, '0'],
        [newerThread, '0'],
      ]);
      expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(2);
      expect([await playbook.runOf(older), await playbook.runOf(newer)]).toMatchObject([
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
      ]);
    },
  );
});
