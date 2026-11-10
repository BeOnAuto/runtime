import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const answeredFirst = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73';

const channel = '#approvals-sales';

const keyedByTheChannel = threadDocument({
  replies: threadReplies.filter((line) => !line.startsWith('  conversation:')),
});

async function twoThreads(): Promise<{ readonly playbook: ChatHarness; readonly threads: readonly string[] }> {
  const playbook = await chatHarness({ document: keyedByTheChannel });
  await playbook.askInThread(older);
  await playbook.askInThread(newer);
  await playbook.performDue(Date.now());
  return { playbook, threads: playbook.chat.posted().map(({ ts }) => ts) };
}

describe('what one read of a turn found, at the end of the turn', () => {
  it('rests the conversation once every request in it was answered by one read or another', async () => {
    const { playbook, threads } = await twoThreads();
    playbook.chat.reply({ channel, thread: threads[0], user: answererId, text: 'approve' });
    playbook.chat.reply({ channel, thread: threads[1], user: answererId, text: 'reject' });

    await playbook.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(2);
    expect(row?.row).toMatchObject({ open: false, due_at: null });
  });

  it('starts the cadence again when the answerer replied in a thread an earlier read of the turn read, though a later one found nothing', async () => {
    const { playbook, threads } = await twoThreads();
    playbook.chat.reply({ channel, thread: threads[0], user: answererId, text: 'maybe' });
    await playbook.performReads(Date.now() + farAhead);
    await playbook.performReads(Date.now() + 2 * farAhead);
    playbook.chat.reply({ channel, thread: threads[0], user: answererId, text: 'perhaps' });

    await playbook.performReads(Date.now() + 3 * farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(await recordsOf(playbook.ledger, 'reply_refused')).toHaveLength(2);
    expect(row?.row).toMatchObject({ reads: 0, open: true });
  });
});

const flatOfMore = threadDocument({
  replies: flatReplies.map((line) => (line === '  read:' ? '    limit: 20\n  read:' : line)),
});

describe('a conversation whose replies name no message, read by a second call while the first still reads it', () => {
  it('reads the second call from where the conversation was, so a reply decided before is not listed again', async () => {
    const playbook = await chatHarness({ document: threadDocument({ replies: flatReplies }) });
    await playbook.define('approve-plan', flatOfMore);
    await playbook.askInThread(answeredFirst);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'approve' });
    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now());
    await playbook.askInThread(older);
    await playbook.ask('approve-plan', { team: 'sales', owner: answererId, campaign: 'Autumn' }, newer);
    await playbook.performDue(Date.now());

    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies')).toMatchObject([
      { input: { oldest: '0' } },
      { input: { oldest: '1699.000002' } },
      { input: { oldest: '1699.000002', limit: 20 } },
    ]);
    expect(await recordsOf(playbook.ledger, 'reply_refused')).toEqual([]);
  });
});
