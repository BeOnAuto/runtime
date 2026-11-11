import type { OneCall } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { threadReplies } from '../testing/documents.ts';
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

const keyedByTheChannel = threadDocument({
  replies: threadReplies.filter((line) => !line.startsWith('  conversation:')),
});

const slowReadMs = 80_000;

const holdMs = 140_000;

function runIdOf(index: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`;
}

function threadOf(index: number): string {
  return `1699.${String(index).padStart(6, '0')}`;
}

function threadsRead(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'thread_replies')
    .map(({ input }) => input['ts']);
}

async function waitingInOneChannel(count: number, duringCall?: (call: OneCall) => Effect.Effect<unknown>) {
  const playbook = await chatHarness({
    document: keyedByTheChannel,
    ...(duringCall === undefined ? {} : { duringCall }),
  });
  await Promise.all(Array.from({ length: count }, (_, at) => playbook.askInThread(runIdOf(at + 1))));
  await playbook.performDue(Date.now());
  return playbook;
}

function slowReads() {
  const dues: unknown[] = [];
  const holder: { playbook?: ChatHarness } = {};
  const dueOfTheConversation = async () => {
    const [row] = holder.playbook === undefined ? [] : await conversationRows(holder.playbook.ledger);
    dues.push(row?.row['due_at']);
  };
  return {
    dues: (): readonly unknown[] => [...dues],
    hold: (playbook: ChatHarness) => {
      holder.playbook = playbook;
    },
    during: ({ reference }: OneCall): Effect.Effect<unknown> =>
      reference.tool === 'thread_replies'
        ? Effect.promise(async () => {
            await dueOfTheConversation();
            vi.setSystemTime(Date.now() + slowReadMs);
          })
        : Effect.void,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a turn of a conversation whose provider answers slowly', () => {
  it('holds the conversation past its longest reads, starts no read that could not end within that hold, and starts the next turn with the first it left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const slow = slowReads();
    const playbook = await waitingInOneChannel(3, slow.during);
    slow.hold(playbook);
    const first = Date.now() + 120_000;
    vi.setSystemTime(first);

    await playbook.performReads(first);
    const second = Date.now() + 60_000;
    vi.setSystemTime(second);
    await playbook.performReads(second);

    expect(threadsRead(playbook)).toEqual([threadOf(1), threadOf(2)]);
    expect(slow.dues()).toEqual([first + holdMs, second + holdMs]);
  });
});

describe('a provider that asks a conversation to wait, turn after turn', () => {
  it('is recorded once when the waiting starts, not while it lasts, and again once a turn has read all it chose', async () => {
    const playbook = await waitingInOneChannel(2);
    const wait = {
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 429',
      retryAfterMs: 60_000,
    } as const;
    playbook.chat.answerNext(answered({ messages: [] }), wait);
    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.answerNext(wait);
    await playbook.performReads(Date.now() + 2 * farAhead);
    const whileItLasts = await recordsOf(playbook.ledger, 'reading_failed');
    await playbook.performReads(Date.now() + 3 * farAhead);
    playbook.chat.answerNext(wait);

    await playbook.performReads(Date.now() + 4 * farAhead);

    expect(threadsRead(playbook)).toEqual([1, 2, 2, 2, 1, 2].map((index) => threadOf(index)));
    expect(whileItLasts).toHaveLength(1);
    expect(await recordsOf(playbook.ledger, 'reading_failed')).toMatchObject([
      { data: { retry_after_ms: 60_000 } },
      { data: { retry_after_ms: 60_000 } },
    ]);
  });
});

describe('a provider that asks a conversation to wait after another failure while it waits', () => {
  it('is recorded for each failure the waiting changes to, and not again while one lasts', async () => {
    const playbook = await waitingInOneChannel(1);
    const limited = {
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 429',
      retryAfterMs: 60_000,
    } as const;
    const unavailable = { ...limited, detail: 'The tool server answered HTTP 503' };
    playbook.chat.answerNext(limited);
    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.answerNext(unavailable);
    await playbook.performReads(Date.now() + 2 * farAhead);
    playbook.chat.answerNext(unavailable);
    await playbook.performReads(Date.now() + 3 * farAhead);
    playbook.chat.answerNext(limited);

    await playbook.performReads(Date.now() + 4 * farAhead);

    expect(await recordsOf(playbook.ledger, 'reading_failed')).toMatchObject([
      { data: { detail: limited.detail } },
      { data: { detail: unavailable.detail } },
      { data: { detail: limited.detail } },
    ]);
    expect(await recordsOf(playbook.ledger, 'reading_failed')).toHaveLength(3);
  });
});

const tellingMs = 70_000;

function slowOnceStarted() {
  const slow = { on: false };
  return {
    start: () => {
      slow.on = true;
    },
    during: (): Effect.Effect<unknown> =>
      slow.on ? Effect.sync(() => vi.setSystemTime(Date.now() + tellingMs)) : Effect.void,
  };
}

describe('a read whose refusals a slow provider is told of', () => {
  it('starts no telling its hold has no room for, and leaves that refusal and every reply after it to the next turn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const slow = slowOnceStarted();
    const playbook = await waitingInOneChannel(1, slow.during);
    const [thread = ''] = playbook.chat.posted().map(({ ts }) => ts);
    const replies = ['maybe', 'x'.repeat(8193), 'approve'].map((text) =>
      playbook.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text }),
    );
    slow.start();
    const first = Date.now() + 120_000;
    vi.setSystemTime(first);
    await playbook.performReads(first);
    const refusedFirst = await recordsOf(playbook.ledger, 'reply_refused');
    const answeredFirst = await recordsOf(playbook.ledger, 'request_answered');
    const second = Date.now() + 120_000;
    vi.setSystemTime(second);

    await playbook.performReads(second);

    expect(refusedFirst).toMatchObject([{ data: { reply: { id: replies[0] } } }]);
    expect(refusedFirst).toHaveLength(1);
    expect(answeredFirst).toEqual([]);
    expect(await recordsOf(playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { reply: { id: replies[0] }, told: true } },
      { data: { reply: { id: replies[1] }, told: true } },
    ]);
    expect(
      (await recordsOf(playbook.ledger, 'telling_started')).map(({ context }) => Date.parse(String(context['at']))),
    ).toEqual([first + tellingMs, second + tellingMs]);
    expect(await recordsOf(playbook.ledger, 'request_answered')).toMatchObject([
      { data: { reply: { id: replies[2] } } },
    ]);
  });
});
