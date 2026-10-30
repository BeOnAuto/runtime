import { describe, expect, it } from 'vitest';

import { replyWaitMsOf, waitBefore, waitBeforeRead } from './cadence.ts';

const second = 1000;

const day = 86_400 * second;

function readTimesOf(count: number): readonly number[] {
  const times: number[] = [];
  for (let read = 1; read <= count; read += 1) {
    times.push((times.at(-1) ?? 0) + waitBeforeRead(read));
  }
  return times;
}

const readTimes = readTimesOf(9000);

function readsToFindAnAnswerGivenAt(answeredAt: number): number {
  return readTimes.findIndex((readAt) => readAt >= answeredAt) + 1;
}

function readsWithin(open: number): number {
  return readTimes.filter((readAt) => readAt <= open).length;
}

describe('the cadence of reading a conversation', () => {
  it('reads at five seconds, doubles to forty, reads each minute to the eighteenth read and every five minutes after', () => {
    expect([1, 2, 3, 4, 5, 18, 19, 300].map((read) => waitBeforeRead(read) / second)).toEqual([
      5, 10, 20, 40, 60, 60, 300, 300,
    ]);
  });

  it('costs four reads for an answer within a minute and eighteen within a quarter of an hour, the last at 915 s', () => {
    expect([readsToFindAnAnswerGivenAt(60 * second), readsToFindAnAnswerGivenAt(900 * second)]).toEqual([4, 18]);
    expect(readTimes[17]).toBe(915 * second);
  });

  it('reads 302 times in a day and 8,654 times in thirty days', () => {
    expect([readsWithin(day), readsWithin(30 * day)]).toEqual([302, 8654]);
  });

  it('never waits less than the floor, and as long as a Retry-After asks, an hour at most', () => {
    const waits = [
      waitBefore({ read: 1, floorMs: 60 * second, retryAfterMs: null }),
      waitBefore({ read: 19, floorMs: 5 * second, retryAfterMs: null }),
      waitBefore({ read: 1, floorMs: 5 * second, retryAfterMs: 120 * second }),
      waitBefore({ read: 1, floorMs: 5 * second, retryAfterMs: 2 * day }),
    ];

    expect(waits.map((wait) => wait / second)).toEqual([60, 300, 120, 3600]);
  });
});

describe('the shortest wait of a reading', () => {
  it('is the wait its replies set, and five seconds when they set none or one that is no duration', () => {
    expect([replyWaitMsOf({ wait: 'PT1M' }), replyWaitMsOf({}), replyWaitMsOf({ wait: 'soon' })]).toEqual([
      60_000, 5000, 5000,
    ]);
  });
});
