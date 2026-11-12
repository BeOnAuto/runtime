import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatConversations } from '../testing/chat-conversations.ts';
import { answererId, chatHarness, conversationRows, recordsOf, type ChatHarness } from '../testing/chat-harness.ts';
import { threadDocument, threadReplies } from '../testing/documents.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { theChannel } from '../testing/woken-conversations.ts';
import { connectionWake } from './connection-wakes.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const T0 = Date.parse('2026-11-12T09:00:00.000Z');

const SECOND = 1000;

const everyFiveSeconds = threadDocument({ replies: threadReplies.filter((line) => line !== '  wait: PT1M') });

const limitedTo = (windowSeconds: number) => ({
  ...chatConversations,
  read_limit: { quota: 1, window_seconds: windowSeconds },
});

interface Day {
  readonly windowSeconds: number;
  readonly replyAt: number;
  readonly endsAt: number;
  readonly busyEveryMs?: number;
}

interface Lived {
  readonly answeredAt: number;
  readonly reads: readonly number[];
  readonly failed: number;
}

const never = Number.POSITIVE_INFINITY;

const readsOf = (playbook: ChatHarness) =>
  playbook.chat.calls().filter(({ reference }) => reference.tool === 'thread_replies').length;

function aLife(playbook: ChatHarness, day: Day, thread: string | undefined) {
  const wake = connectionWake({ ledger: playbook.ledger.service });
  const reads: number[] = [];
  const answered = { at: never };
  return {
    reads,
    answered,
    second: (at: number) =>
      Effect.promise(async () => {
        if (answered.at !== never) {
          return;
        }
        vi.setSystemTime(at);
        if (at === day.replyAt) {
          playbook.chat.reply({ channel: theChannel, thread, user: answererId, text: 'approve' });
        }
        if (day.busyEveryMs !== undefined && ((at - T0) % day.busyEveryMs === 0 || at === day.replyAt)) {
          await Effect.runPromise(wake({ playbook: alpha, connection: 'chat', conversation: theChannel }, at));
        }
        const before = readsOf(playbook);
        await playbook.performReads(at);
        if (readsOf(playbook) > before) {
          reads.push(at);
        }
        if ((await recordsOf(playbook.ledger, 'request_answered')).length > 0) {
          answered.at = at;
        }
      }),
  };
}

async function aDay(day: Day): Promise<Lived> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const playbook = await chatHarness({ document: everyFiveSeconds, conversations: limitedTo(day.windowSeconds) });
  await playbook.askInThread(runId);
  await playbook.performDue(T0);
  const [request] = playbook.chat.posted();
  const life = aLife(playbook, day, request?.ts);
  const seconds = Array.from({ length: (day.endsAt - T0) / SECOND }, (_, at) => T0 + (at + 1) * SECOND);
  await Effect.runPromise(Effect.forEach(seconds, life.second, { discard: true }));
  const failed = (await recordsOf(playbook.ledger, 'reading_failed')).length;
  return { answeredAt: life.answered.at, reads: life.reads, failed };
}

/** The reads a service that keeps the limit would refuse: each that came sooner than its window after the one before. */
const refusedOf = ({ reads }: Lived, windowSeconds: number) =>
  reads.slice(1).filter((at, index) => at - (reads[index] ?? at) < windowSeconds * SECOND).length;

afterEach(() => {
  vi.useRealTimers();
});

describe('a provider that limits how often a conversation is read', () => {
  it('has its timer read no sooner than the window after the last read, the first read among them', async () => {
    const lived = await aDay({ windowSeconds: 10, replyAt: T0 + 400 * SECOND, endsAt: T0 + 120 * SECOND });

    expect(lived.reads.slice(0, 4)).toEqual([T0 + 10 * SECOND, T0 + 20 * SECOND, T0 + 40 * SECOND, T0 + 80 * SECOND]);
    expect([refusedOf(lived, 10), lived.failed]).toEqual([0, 0]);
  });

  it('has a woken read that takes nothing leave the timer’s next read where it was', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const playbook = await chatHarness({ document: everyFiveSeconds, conversations: limitedTo(10) });
    await playbook.askInThread(runId);
    await playbook.performDue(T0);
    const readAt = (at: number) =>
      Effect.promise(() => {
        vi.setSystemTime(T0 + at * SECOND);
        return playbook.performReads(T0 + at * SECOND);
      });
    await Effect.runPromise(Effect.forEach([10, 20, 30, 50, 90], readAt, { discard: true }));
    const timed = (await conversationRows(playbook.ledger))[0]?.row;
    const wakeAt = T0 + 91 * SECOND;
    vi.setSystemTime(wakeAt);
    const wake = connectionWake({ ledger: playbook.ledger.service });
    await Effect.runPromise(wake({ playbook: alpha, connection: 'chat', conversation: theChannel }, wakeAt));

    expect((await conversationRows(playbook.ledger))[0]?.row).toEqual({ ...timed, due_at: wakeAt + 10 * SECOND });

    vi.setSystemTime(wakeAt + 10 * SECOND);
    await playbook.performReads(wakeAt + 10 * SECOND);

    expect((await conversationRows(playbook.ledger))[0]?.row).toEqual(timed);
  });
});

const days: readonly (readonly [string, Day])[] = [
  ['a reply just after a timed read', { windowSeconds: 10, replyAt: T0 + 151 * SECOND, endsAt: T0 + 400 * SECOND }],
  ['a reply just before a timed read', { windowSeconds: 10, replyAt: T0 + 139 * SECOND, endsAt: T0 + 400 * SECOND }],
  [
    'a reply under a limit of one a minute',
    { windowSeconds: 60, replyAt: T0 + 250 * SECOND, endsAt: T0 + 600 * SECOND },
  ],
  [
    'a reply under a limit of one a minute, once the timer reads every five minutes',
    { windowSeconds: 60, replyAt: T0 + 1200 * SECOND, endsAt: T0 + 1500 * SECOND },
  ],
];

const sooner: readonly (readonly [string, Day, number])[] = [
  ['a limit of one in ten seconds', { windowSeconds: 10, replyAt: T0 + 151 * SECOND, endsAt: T0 + 400 * SECOND }, 200],
  [
    'a limit of one a minute, once the timer reads every five minutes',
    { windowSeconds: 60, replyAt: T0 + 1200 * SECOND, endsAt: T0 + 1500 * SECOND },
    1380,
  ],
];

describe('a busy conversation, where every message wakes its read', () => {
  it.each(days)(
    'never takes a reply later than the timer alone, nor reads sooner than the limit, nor fails a read: %s',
    async (_, day) => {
      const timerAlone = await aDay(day);
      const woken = await aDay({ ...day, busyEveryMs: 3 * SECOND });

      expect(timerAlone.answeredAt).toBeLessThan(never);
      expect(woken.answeredAt).toBeLessThanOrEqual(timerAlone.answeredAt);
      expect(woken.reads.length).toBeGreaterThanOrEqual(timerAlone.reads.length);
      expect([refusedOf(woken, day.windowSeconds), woken.failed]).toEqual([
        refusedOf(timerAlone, day.windowSeconds),
        timerAlone.failed,
      ]);
      expect(refusedOf(woken, day.windowSeconds)).toBe(0);
    },
    60_000,
  );

  it.each(sooner)(
    'reads it within the limit of the reply where the timer’s next read is more than twice the limit away: %s',
    async (_, day, timedSeconds) => {
      const timerAlone = await aDay(day);
      const woken = await aDay({ ...day, busyEveryMs: 3 * SECOND });

      expect(woken.answeredAt).toBeLessThanOrEqual(day.replyAt + day.windowSeconds * SECOND);
      expect(timerAlone.answeredAt).toBe(T0 + timedSeconds * SECOND);
    },
    60_000,
  );
});
