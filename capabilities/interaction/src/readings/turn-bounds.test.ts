import { describe, expect, it } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
import {
  answered,
  chatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
} from '../testing/index.ts';

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
