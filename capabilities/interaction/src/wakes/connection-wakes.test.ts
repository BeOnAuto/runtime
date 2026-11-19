import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { conversationRowFrom } from '../conversations/conversation-rows.ts';
import { chatHarness, conversationRows, recordsOf, type ChatHarness } from '../testing/chat-harness.ts';
import { threadDocument, threadReplies } from '../testing/documents.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { threadOfTheChannelReplies } from '../testing/reading-documents.ts';
import { readOnce, theChannel } from '../testing/woken-conversations.ts';
import { connectionWake } from './connection-wakes.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const fiveSeconds = 5000;

const theMessageAnswered: unknown = expect.any(String);

const T0 = Date.parse('2026-11-12T09:00:00.000Z');

const second = 1000;

const hour = 3600 * second;

const threeRuns = [
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b81',
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b82',
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b83',
];

const everyFiveSeconds = (replies: readonly string[]) =>
  threadDocument({ replies: replies.filter((line) => line !== '  wait: PT1M') });

const aConversationEachThread = everyFiveSeconds(threadReplies);

const oneConversationOfTheChannel = everyFiveSeconds(threadOfTheChannelReplies);

function inTurn<A>(items: readonly A[], each: (item: A, index: number) => Promise<unknown>): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(items, (item, index) => Effect.promise(() => each(item, index)), { discard: true }),
  );
}

function threadsReadBy(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => input['ts']);
}

interface WaitingThrough {
  readonly playbook: ChatHarness;
  readonly lastReadAt: number;
  readonly wake: (now: number, conversation?: string) => Promise<void>;
  readonly read: (now: number) => Promise<number>;
  /** For each conversation, by when it was last active: the seconds after T0 it was, and the seconds after `now` it is due. */
  readonly dueAfter: (now: number) => Promise<readonly (readonly [number, number | null])[]>;
}

function clockSetTo(now: number): number {
  vi.setSystemTime(now);
  return now;
}

/** Requests asked through the chat a floor apart from T0, then read four times an hour apart, so each conversation's timed read is a minute after the last. */
async function askedAFloorApart(document: string, runIds: readonly string[]): Promise<WaitingThrough> {
  vi.useFakeTimers({ toFake: ['Date'] });
  const playbook = await chatHarness({ document });
  await inTurn(runIds, async (asked, index) => {
    const now = clockSetTo(T0 + index * fiveSeconds);
    await playbook.askInThread(asked);
    await playbook.performDue(now);
  });
  await inTurn([1, 2, 3, 4], (hours) => playbook.performReads(clockSetTo(T0 + hours * hour)));
  const wake = connectionWake({ ledger: playbook.ledger.service });
  return {
    playbook,
    lastReadAt: T0 + 4 * hour,
    wake: (now, conversation) =>
      Effect.runPromise(
        wake(
          { org: alpha.org, connection: 'chat', ...(conversation === undefined ? {} : { conversation }) },
          clockSetTo(now),
        ),
      ),
    read: (now) => playbook.performReads(clockSetTo(now)),
    dueAfter: async (now) =>
      (await conversationRows(playbook.ledger))
        .map(({ row }) => conversationRowFrom(row))
        .toSorted((one, other) => one.active_at - other.active_at)
        .map(({ active_at: activeAt, due_at: dueAt }) => [
          (activeAt - T0) / second,
          dueAt === null ? null : (dueAt - now) / second,
        ]),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a wake of a connection', () => {
  it('makes a conversation waiting through it due the shortest wait of its reading after the wake, its own next read kept', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();

    await waiting.wake(waiting.readAt);

    expect(await waiting.row()).toEqual({ ...before, due_at: waiting.readAt + fiveSeconds });
  });

  it('answers nothing by itself: the read it makes due takes the reply, and says that a wake caused it', async () => {
    const waiting = await readOnce(runId);
    waiting.approve();
    await waiting.wake(waiting.readAt);
    const calls = waiting.playbook.chat.calls().length;

    expect(await recordsOf(waiting.playbook.ledger, 'request_answered')).toEqual([]);

    await waiting.playbook.performReads(waiting.readAt + fiveSeconds);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls + 1);
    expect(await recordsOf(waiting.playbook.ledger, 'request_answered', 'replies_read')).toMatchObject([
      { type: 'request_answered', data: { answer: { choice: 'approve' }, reply: { to: theMessageAnswered } } },
      { type: 'replies_read', data: { server: 'chat', taken: 1, woken: true } },
    ]);
  });

  it('reads no sooner than the shortest wait after its last read', async () => {
    const waiting = await readOnce(runId);
    const calls = waiting.playbook.chat.calls().length;
    await waiting.wake(waiting.readAt);

    await waiting.playbook.performReads(waiting.readAt + fiveSeconds - 1);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls);
  });
});

describe('several wakes of a connection', () => {
  it('in a burst are one read', async () => {
    const waiting = await readOnce(runId);
    const calls = waiting.playbook.chat.calls().length;
    const burst = Array.from({ length: 100 }, (_, index) => waiting.readAt + index * 10);

    await Effect.runPromise(Effect.forEach(burst, (at) => Effect.promise(() => waiting.wake(at)), { discard: true }));
    await waiting.playbook.performReads(waiting.readAt + 2 * fiveSeconds);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls + 1);
  });
});

describe('a wake and the timed read of the same conversation', () => {
  it('falling together are one read and one answer', async () => {
    const waiting = await readOnce(runId);
    const calls = waiting.playbook.chat.calls().length;
    waiting.approve();
    await waiting.wake(waiting.readAt);

    await waiting.playbook.performReads(waiting.readAt + 60_000);

    expect(waiting.playbook.chat.calls()).toHaveLength(calls + 1);
    expect(await recordsOf(waiting.playbook.ledger, 'request_answered')).toHaveLength(1);
  });

  it('leave the conversation as it is where the timed read is due within the shortest wait of the woken one, and that read says no wake caused it', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();
    waiting.approve();

    await waiting.wake(waiting.readAt + 2 * fiveSeconds + 2000);
    const after = await waiting.row();
    await waiting.playbook.performReads(waiting.readAt + 4 * fiveSeconds);
    const [read] = await recordsOf(waiting.playbook.ledger, 'replies_read');

    expect(after).toEqual(before);
    expect(read?.data).toMatchObject({ taken: 1 });
    expect(read?.data).not.toHaveProperty('woken');
  });
});

describe('a wake that names the conversation an arrival is about', () => {
  it('makes due the conversations of the requests whose messages were delivered there, and no other', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();

    await waiting.wake(waiting.readAt, { conversation: '#approvals-marketing' });

    expect(await waiting.row()).toEqual(before);

    await waiting.wake(waiting.readAt, { conversation: theChannel });

    expect(await waiting.row()).toEqual({ ...before, due_at: waiting.readAt + fiveSeconds });
  });

  it('makes each conversation it names due a floor after it, however many wait through the connection', async () => {
    const waiting = await askedAFloorApart(aConversationEachThread, threeRuns);

    await waiting.wake(waiting.lastReadAt, theChannel);

    expect(await waiting.dueAfter(waiting.lastReadAt)).toEqual([
      [0, 5],
      [5, 5],
      [10, 5],
    ]);
  });
});

describe('a wake that names no conversation, where several wait through the connection', () => {
  it('makes each of three conversations due at the end of its own window of three floors, one to three floors after it', async () => {
    const waiting = await askedAFloorApart(aConversationEachThread, threeRuns);

    await waiting.wake(waiting.lastReadAt);

    expect(await waiting.dueAfter(waiting.lastReadAt)).toEqual([
      [0, 15],
      [5, 5],
      [10, 10],
    ]);
  });

  it('coming every floor for six floors, reads each of the three twice', async () => {
    const waiting = await askedAFloorApart(aConversationEachThread, threeRuns);
    const readBefore = threadsReadBy(waiting.playbook).length;
    const floors = [0, 1, 2, 3, 4, 5].map((floor) => waiting.lastReadAt + floor * fiveSeconds);

    await inTurn(floors, async (now) => {
      await waiting.wake(now);
      await waiting.read(now);
    });
    await waiting.read(waiting.lastReadAt + 6 * fiveSeconds);
    const read = threadsReadBy(waiting.playbook).slice(readBefore);

    expect(waiting.playbook.chat.posted().map(({ ts }) => read.filter((thread) => thread === ts).length)).toEqual([
      2, 2, 2,
    ]);
  });

  it('counts two readings of one conversation as two reads', async () => {
    const waiting = await askedAFloorApart(oneConversationOfTheChannel, threeRuns.slice(0, 2));
    const wokenAt = waiting.lastReadAt + fiveSeconds;

    await waiting.wake(wokenAt);

    expect(await waiting.dueAfter(wokenAt)).toEqual([[5, 10]]);
  });
});
