import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  answered,
  answererId,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
  type FakeAnswer,
} from '../testing/index.ts';

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

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
