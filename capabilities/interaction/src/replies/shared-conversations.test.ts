import type { RecordWork } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';
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
  type ChatHarnessOptions,
} from '../testing/index.ts';
import { flatReplies } from '../testing/reading-documents.ts';

const older = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const newer = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

const keyedByTheChannel = threadDocument({
  replies: threadReplies.filter((line) => !line.startsWith('  conversation:')),
});

async function deliveredInOneChannel(options: ChatHarnessOptions = {}) {
  const playbook = await chatHarness({ document: keyedByTheChannel, ...options });
  await playbook.askInThread(older);
  await playbook.askInThread(newer);
  await playbook.performDue(Date.now());
  const [olderThread = '', newerThread = ''] = playbook.chat.posted().map(({ ts }) => ts);
  return { playbook, olderThread, newerThread };
}

function threadsRead(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => [input['ts'], input['oldest']]);
}

async function outputsOf(playbook: ChatHarness): Promise<readonly unknown[]> {
  await playbook.performDue(Date.now());
  return [await playbook.runOf(older), await playbook.runOf(newer)];
}

describe('two requests waiting in one channel, their replies read by thread and their key the channel', () => {
  it('reads both threads, so a reply in the newer one is taken by the newer, and the older still waits', async () => {
    const { playbook, olderThread, newerThread } = await deliveredInOneChannel();
    playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(threadsRead(playbook)).toEqual([
      [olderThread, '0'],
      [newerThread, '0'],
    ]);
    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });

  it('takes a reply in the older thread for the older, and the newer still waits', async () => {
    const { playbook, olderThread } = await deliveredInOneChannel();
    playbook.chat.reply({ channel, thread: olderThread, user: answererId, text: 'reject, the dates are wrong' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'reject', note: 'the dates are wrong' } } },
      { output: { status: 'started' } },
    ]);
  });
});

describe('two requests waiting in one channel with replies in both threads, or from someone else', () => {
  it('takes a reply in each thread for the request of that thread', async () => {
    const { playbook, olderThread, newerThread } = await deliveredInOneChannel();
    playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'approve' });
    playbook.chat.reply({ channel, thread: olderThread, user: answererId, text: 'reject' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });

  it('passes over a reply in a thread from anyone but its answerer, and records it nowhere', async () => {
    const { playbook, newerThread } = await deliveredInOneChannel();
    playbook.chat.reply({ channel, thread: newerThread, user: 'U0STRANGER', text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'started' } },
    ]);
  });
});

describe('the cursor of each thread', () => {
  it('is its own, so a reply in the newer thread is taken though the older one was read past its id, after a read of it failed', async () => {
    const { playbook, olderThread, newerThread } = await deliveredInOneChannel();
    playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'approve' });
    playbook.chat.answerNext(
      answered({ messages: [{ ts: '1699.000009', user: 'U0STRANGER', text: 'looks fine', thread_ts: olderThread }] }),
      { outcome: 'timed_out', detail: 'The tool server did not answer within 30000 ms', retryAfterMs: null },
    );
    await playbook.performReads(Date.now() + farAhead);

    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(threadsRead(playbook)).toEqual([
      [olderThread, '0'],
      [newerThread, '0'],
      [olderThread, '1699.000009'],
      [newerThread, '0'],
    ]);
    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });
});

const fromItsMessage = threadDocument({
  replies: flatReplies.map((line) =>
    line.startsWith('    oldest:') ? "    oldest: '{{ since | default: sent.id }}'" : line,
  ),
});

const notNow = new Unavailable({ detail: 'The answer could not be recorded just now; ask again in a moment' });

function unavailableOnceForAnAnswer(record: RecordWork): RecordWork {
  const refused = { once: false };
  return (run, work, lineage, rule) => {
    const first = work.type === 'answer' && !refused.once;
    refused.once ||= first;
    return first ? Effect.fail(notNow) : record(run, work, lineage, rule);
  };
}

describe('a reply in one thread whose answer the run cannot record just now', () => {
  it('is read again in that thread from where it was, and taken then, while the other thread is read on', async () => {
    const { playbook, olderThread, newerThread } = await deliveredInOneChannel({
      recording: unavailableOnceForAnAnswer,
    });
    playbook.chat.reply({ channel, thread: newerThread, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    const takenFirst = await recordsOf(playbook.ledger, 'request_answered');
    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(takenFirst).toEqual([]);
    expect(threadsRead(playbook)).toEqual([
      [olderThread, '0'],
      [newerThread, '0'],
      [olderThread, '0'],
      [newerThread, '0'],
    ]);
    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });
});

describe('two requests waiting in one conversation whose reads list it from each one’s own message on', () => {
  it('reads it twice, once for each, and refuses a reply that names no message once, answering neither', async () => {
    const { playbook } = await deliveredInOneChannel({ document: fromItsMessage });
    playbook.chat.reply({ channel, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);

    expect(playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies')).toHaveLength(2);
    expect(await recordsOf(playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { because: 'ambiguous', told: true } },
    ]);
    expect(await outputsOf(playbook)).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'started' } },
    ]);
  });
});
