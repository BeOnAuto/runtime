import { describe, expect, it } from 'vitest';

import { conversations } from '../conversations/conversation-rows.ts';
import { openRequests } from '../requests/open-requests.ts';
import {
  answererId,
  beforeReadings,
  chatHarness,
  conversationRows,
  farAhead,
  keptAsRecorded,
  readsPastTheBound,
  recordedBeforeReadings,
  recordedReadsPastTheBound,
  recordsOf,
  type ChatHarness,
} from '../testing/index.ts';
import { ledgerHoldingRuns } from '../testing/interaction-harness.ts';
import { readings } from './reading-rows.ts';

const { older, newer, answeredFlat, waitingFlat, unreadableBeside, unreadableAlone } = beforeReadings;

interface Waiting {
  readonly playbook: ChatHarness;
  readonly settledAt: number;
}

const renderedUnderTodaysBound = (channel: string) => `${'a'.repeat(16_240)}${channel.repeat(20)}`;

async function waitingSinceBefore(recorded = recordedBeforeReadings()): Promise<Waiting> {
  const ledger = ledgerHoldingRuns([openRequests, conversations, readings]);
  await keptAsRecorded(ledger.service, recorded.facts);
  const playbook = await chatHarness({ ledger, inTheChat: recorded.messages });
  return { playbook, settledAt: recorded.lastAt + 60_000 };
}

function readsIn(playbook: ChatHarness, channel: string): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference, input }) => reference.tool === 'thread_replies' && input['channel'] === channel)
    .map(({ input }) => [input['ts'], input['oldest']]);
}

async function statusesOf(playbook: ChatHarness, settledAt: number): Promise<readonly unknown[]> {
  await playbook.performDue(settledAt);
  return Promise.all(
    [older, newer, answeredFlat, waitingFlat, unreadableBeside, unreadableAlone].map((runId) => playbook.runOf(runId)),
  );
}

describe('requests a release before readings delivered, waiting in one channel', () => {
  it('are each read by a read of their own, each thread from its start, so the reply nobody read is taken and the one refused before is neither refused nor told again', async () => {
    const { playbook, settledAt } = await waitingSinceBefore();

    await playbook.performReads(Date.now() + farAhead);

    expect(readsIn(playbook, '#approvals-sales')).toEqual([
      ['1699.000001', '0'],
      ['1699.000002', '0'],
      [renderedUnderTodaysBound('#approvals-sales'), '1699.000009'],
    ]);
    expect(await recordsOf(playbook.ledger, 'telling_started')).toHaveLength(1);
    expect(await statusesOf(playbook, settledAt)).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'started' } },
      { output: { status: 'started' } },
      { output: { status: 'started' } },
    ]);
    expect((await recordsOf(playbook.ledger, 'reply_refused')).map(({ data }) => data)).toMatchObject([
      { reply: { id: '1699.000006' }, because: 'not_an_answer', told: true },
    ]);
  });
});

describe('requests a release before readings delivered, once read again', () => {
  it('take a reply in the older thread for the older, and a plain reply in the flat conversation for the one waiting there, never the reply an earlier request took', async () => {
    const { playbook, settledAt } = await waitingSinceBefore();
    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.reply({ channel: '#approvals-sales', thread: '1699.000001', user: answererId, text: 'reject, no' });
    playbook.chat.reply({ channel: '#approvals-ops', user: answererId, text: 'reject' });

    await playbook.performReads(Date.now() + 2 * farAhead);

    expect(readsIn(playbook, '#approvals-ops')).toEqual([
      [undefined, '1699.000008'],
      [undefined, '1699.000008'],
    ]);
    expect(await statusesOf(playbook, settledAt)).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'reject', note: 'no' } } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
      { output: { status: 'started' } },
      { output: { status: 'started' } },
    ]);
    expect(await recordsOf(playbook.ledger, 'request_answered')).toHaveLength(4);
  });
});

describe('requests a release before readings delivered whose reads passed the 16 KiB a call then took', () => {
  it('render under today’s 256 KiB and are read, beside the threads from where the conversation was', async () => {
    const { playbook } = await waitingSinceBefore();

    await playbook.performReads(Date.now() + farAhead);

    expect(readsIn(playbook, '#approvals-sales').at(-1)).toEqual([
      renderedUnderTodaysBound('#approvals-sales'),
      '1699.000009',
    ]);
    expect(readsIn(playbook, '#approvals-legal')).toEqual([[renderedUnderTodaysBound('#approvals-legal'), '0']]);
  });
});

const { beside, unrenderedBeside, unrenderedAlone } = readsPastTheBound;

describe('requests main delivered with no reading whose reads render past today’s bound', () => {
  it('are passed over beside others, and a conversation of one alone rests, as before', async () => {
    const { playbook, settledAt } = await waitingSinceBefore(recordedReadsPastTheBound());

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(settledAt);
    const legal = (await conversationRows(playbook.ledger)).find(({ key }) => key.endsWith('#approvals-legal'));

    expect(readsIn(playbook, '#approvals-sales')).toEqual([['1699.000001', '0']]);
    expect(readsIn(playbook, '#approvals-legal')).toEqual([]);
    expect((await recordsOf(playbook.ledger, 'reading_failed')).map(({ data }) => data)).toMatchObject([
      { conversation: '#approvals-legal', because: 'not_sent' },
      { conversation: '#approvals-legal', because: 'not_sent' },
    ]);
    expect(legal?.row).toMatchObject({ open: false, due_at: null });
    expect(
      await Promise.all([beside, unrenderedBeside, unrenderedAlone].map((runId) => playbook.runOf(runId))),
    ).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'started' } },
      { output: { status: 'started' } },
    ]);
  });
});
