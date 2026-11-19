import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  answered,
  answererId,
  chatHarness,
  type ChatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  threadDocument,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const keyedByTheChannel = threadDocument({
  replies: threadReplies.filter((line) => !line.startsWith('  conversation:')),
});

function runIdOf(index: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`;
}

async function waitingInOneChannel(count: number): Promise<ChatHarness> {
  const playbook = await chatHarness({ document: keyedByTheChannel });
  await Promise.all(Array.from({ length: count }, (_, at) => playbook.askInThread(runIdOf(at + 1))));
  await playbook.performDue(Date.now());
  return playbook;
}

function threadsRead(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => input['ts']);
}

function threadOf(index: number): string {
  return `1699.${String(index).padStart(6, '0')}`;
}

describe('the reads of one conversation in which many requests wait', () => {
  it('are ten at most a turn, and the next turn reads on from the first it left, so every thread is read in turn', async () => {
    const playbook = await waitingInOneChannel(12);

    await playbook.performReads(Date.now() + farAhead);
    const firstTurn = threadsRead(playbook);
    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(firstTurn).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => threadOf(index)));
    expect(threadsRead(playbook).slice(10)).toEqual([11, 12, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => threadOf(index)));
  });

  it('stop at a read the server asks to wait after, and the conversation waits as long, then reads on from that one', async () => {
    const playbook = await waitingInOneChannel(3);
    playbook.chat.answerNext(answered({ messages: [] }), {
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 429',
      retryAfterMs: 120_000,
    });
    const before = Date.now();

    await playbook.performReads(before + farAhead);
    const [row] = await conversationRows(playbook.ledger);
    await playbook.performReads(before + 2 * farAhead);

    expect(await recordsOf(playbook.ledger, 'reading_failed')).toMatchObject([{ data: { retry_after_ms: 120_000 } }]);
    expect(Number(row?.row['next_read_at'])).toBeGreaterThanOrEqual(before + 120_000);
    expect(threadsRead(playbook)).toEqual([1, 2, 2, 3, 1].map((index) => threadOf(index)));
  });
});

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const answeredFirst = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73';

const channel = '#approvals-sales';

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
    const playbook = await chatHarness({
      document: threadDocument({ replies: flatReplies }),
      savedByAnEarlierRelease: true,
    });
    await playbook.defineAsAnEarlierRelease('approve-plan', flatOfMore);
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
