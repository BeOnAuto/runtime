import { describe, expect, it } from 'vitest';

import {
  answered,
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  recordsOf,
  threadDocument,
  type ChatHarness,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const first = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const third = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73';

async function deliveredInThread(playbook: ChatHarness, ...runIds: readonly string[]): Promise<readonly string[]> {
  await Promise.all(runIds.map((runId) => playbook.askInThread(runId)));
  await playbook.performDue(Date.now());
  return playbook.chat.posted().map(({ ts }) => ts);
}

function readsOf(playbook: ChatHarness): number {
  return playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies').length;
}

describe('the replies of a conversation, read once for every open request in it', () => {
  it('takes a reply from the answerer as the answer the run records with the reply as evidence, which the due work settles it from as the playbook', async () => {
    const playbook = await chatHarness();
    const [thread] = await deliveredInThread(playbook, first);
    playbook.chat.reply({
      channel: '#approvals-sales',
      thread,
      user: answererId,
      text: 'Reject, the second point is wrong',
    });

    await playbook.performReads(Date.now() + farAhead);
    const read = await playbook.runOf(first);
    await playbook.performDue(Date.now());

    expect(read).toMatchObject({ output: { status: 'started' } });
    expect(await playbook.runOf(first)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject', note: 'the second point is wrong' }, record: {} },
    });
    expect(await recordsOf(playbook.ledger, 'request_answered', 'replies_read', 'run_succeeded')).toMatchObject([
      {
        type: 'request_answered',
        data: {
          answer: { choice: 'reject', note: 'the second point is wrong' },
          reply: { id: '1699.000002', sender: answererId },
        },
        context: { by: 'playbook:alpha' },
      },
      { type: 'replies_read', data: { conversation: '#approvals-sales/1699.000001', taken: 1, since: '1699.000002' } },
      { type: 'run_succeeded', context: { by: 'playbook:alpha' } },
    ]);
  });

  it('reads one conversation once for three requests in it, and each thread on its own', async () => {
    const flat = await chatHarness({ document: threadDocument({ replies: flatReplies }) });
    await deliveredInThread(flat, first, second, third);
    const threads = await chatHarness();
    await deliveredInThread(threads, first, second, third);

    await flat.performReads(Date.now() + farAhead);
    await threads.performReads(Date.now() + farAhead);

    expect([readsOf(flat), readsOf(threads)]).toEqual([1, 3]);
    expect((await conversationRows(flat.ledger)).map(({ key }) => key)).toEqual([
      'chat/thread_replies/#approvals-sales',
    ]);
  });
});

describe('a read of replies that finds nothing to take', () => {
  it('writes no fact for a read that found nothing, and waits longer before the next', async () => {
    const playbook = await chatHarness();
    await deliveredInThread(playbook, first);
    playbook.chat.answerNext(answered({ messages: [] }));

    await playbook.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(await recordsOf(playbook.ledger, 'replies_read')).toEqual([]);
    expect(row?.row).toMatchObject({ open: true, reads: 1, since: null });
  });

  it('passes over a reply from anyone but the answerer, and records it nowhere', async () => {
    const playbook = await chatHarness();
    const [thread] = await deliveredInThread(playbook, first);
    playbook.chat.reply({ channel: '#approvals-sales', thread, user: 'U0STRANGER', text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
    expect(await recordsOf(playbook.ledger, 'replies_read')).toMatchObject([
      { data: { replies: 1, taken: 0, refused: 0 } },
    ]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'delivered' });
  });

  it('passes over the message the playbook sent itself, so a thread nobody has replied in is a read that found nothing', async () => {
    const playbook = await chatHarness();
    await deliveredInThread(playbook, first);

    await playbook.performReads(Date.now() + farAhead);
    const [row] = await conversationRows(playbook.ledger);

    expect(playbook.chat.posted()).toHaveLength(1);
    expect(await recordsOf(playbook.ledger, 'replies_read')).toEqual([]);
    expect(row?.row).toMatchObject({ open: true, reads: 1, since: null });
  });
});
