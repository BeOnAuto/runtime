import type { RecordWork } from '@on.auto/definitions';
import type { OneCall } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  answererId,
  chatConversations,
  chatHarness,
  farAhead,
  recordsOf,
  threadDocument,
  threadRepliesTelling,
  type ChatHarness,
  type ChatHarnessOptions,
} from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const channel = '#approvals-sales';

const byTheProvider = {
  conversations: chatConversations,
  document: threadDocument({ replies: threadRepliesTelling() }),
};

interface Asked {
  readonly playbook: ChatHarness;
  readonly thread: string;
}

async function asked(options: ChatHarnessOptions): Promise<Asked> {
  const playbook = await chatHarness(options);
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  const [request] = playbook.chat.posted();
  return { playbook, thread: request?.ts ?? '' };
}

function linesOf(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .posted()
    .slice(1)
    .map(({ text, thread_ts: thread }) => [thread, text]);
}

const holdMs = 140_000;

const slowReadMs = 80_000;

const recorded = 'Auto recorded your answer: approve.';

const answeredAlready = "This request was already answered, so Auto didn't take this reply.";

function stoppedAfterTheAnswer(record: RecordWork): RecordWork {
  return (run, work, lineage, rule) =>
    Effect.tap(record(run, work, lineage, rule), () =>
      work.type === 'answer' ? Effect.die(new Error('The runtime stopped')) : Effect.void,
    );
}

function stoppedAtTheMark({ reference }: OneCall): Effect.Effect<unknown> {
  return reference.tool === 'add_reaction' ? Effect.die(new Error('The runtime stopped')) : Effect.void;
}

function slowAtTheRead({ reference }: OneCall): Effect.Effect<unknown> {
  return Effect.sync(() => {
    if (reference.tool === 'thread_replies') {
      vi.setSystemTime(Date.now() + slowReadMs);
    }
  });
}

async function tellingsStarted(playbook: ChatHarness): Promise<readonly unknown[]> {
  return (await recordsOf(playbook.ledger, 'telling_started')).map(({ data }) => data);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the telling of a taken reply, made by the read that took it', () => {
  it('is made by the read that took the answer, so the due work after it finds nothing left to tell', async () => {
    const { playbook, thread } = await asked(byTheProvider);
    const reply = playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    const toldByTheRead = [playbook.chat.reactions(), linesOf(playbook)];
    await playbook.performDue(Date.now() + farAhead);
    await playbook.performDue(Date.now() + 2 * farAhead);

    expect(toldByTheRead).toEqual([[{ channel, timestamp: reply, name: 'white_check_mark' }], [[thread, recorded]]]);
    expect([playbook.chat.reactions(), linesOf(playbook)]).toEqual(toldByTheRead);
    expect(await tellingsStarted(playbook)).toHaveLength(2);
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('is left to the due work where the read has no room left in its hold, and no later reply is told before it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { playbook, thread } = await asked({ ...byTheProvider, duringCall: slowAtTheRead });
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    playbook.chat.reply({ channel, thread, user: answererId, text: 'reject' });
    vi.setSystemTime(Date.now() + farAhead);

    await playbook.performReads(Date.now());
    const answers = await recordsOf(playbook.ledger, 'request_answered');
    const toldByTheRead = [playbook.chat.reactions(), linesOf(playbook)];
    await playbook.performDue(Date.now());

    expect(answers).toHaveLength(1);
    expect(toldByTheRead).toEqual([[], []]);
    expect(playbook.chat.reactions()).toHaveLength(1);
    expect(linesOf(playbook)).toEqual([[thread, recorded]]);
    expect(linesOf(playbook)).not.toContainEqual([thread, answeredAlready]);
  });
});

describe('the telling of a taken reply, after the runtime stopped while making it', () => {
  it('is finished by the due work once the hold of a read that stopped after the mark has passed, making nothing twice', async () => {
    const { playbook, thread } = await asked({ ...byTheProvider, duringCall: stoppedAtTheMark });
    playbook.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    playbook.chat.reply({ channel, thread, user: answererId, text: 'reject' });
    const heldAt = Date.now() + farAhead;

    await expect(playbook.performReads(heldAt)).rejects.toThrow('The runtime stopped');
    await playbook.performDue(heldAt + holdMs - 1);
    const withinTheHold = [playbook.chat.reactions().length, linesOf(playbook)];
    await playbook.performDue(heldAt + holdMs);

    expect(withinTheHold).toEqual([1, []]);
    expect(playbook.chat.reactions()).toHaveLength(1);
    expect(linesOf(playbook)).toEqual([[thread, recorded]]);
    expect(await tellingsStarted(playbook)).toMatchObject([
      { about: 'taken', form: 'mark' },
      { about: 'taken', form: 'line' },
    ]);
  });

  it('is made once after a restart between the answer and the telling, and once by two hosts at the same time', async () => {
    const { playbook: first, thread } = await asked({ ...byTheProvider, recording: stoppedAfterTheAnswer });
    first.chat.reply({ channel, thread, user: answererId, text: 'approve' });
    await expect(first.performReads(Date.now() + farAhead)).rejects.toThrow('The runtime stopped');
    const again = await chatHarness({ ...byTheProvider, ledger: first.ledger, inTheChat: first.chat.posted() });
    const items = await again.dueItems(Date.now() + farAhead);

    await Promise.all([again.performAll(items, Date.now()), again.performAll(items, Date.now())]);
    await again.performDue(Date.now() + 2 * farAhead);

    expect(first.chat.reactions()).toEqual([]);
    expect(again.chat.reactions()).toHaveLength(1);
    expect(linesOf(again)).toEqual([[thread, recorded]]);
    expect(await recordsOf(again.ledger, 'telling_started')).toHaveLength(2);
  });
});
