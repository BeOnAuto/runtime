import { describe, expect, it } from 'vitest';

import { answererId, chatHarness, farAhead, threadDocument } from '../testing/index.ts';
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
