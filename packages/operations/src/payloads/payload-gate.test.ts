import { contentOfText } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { Effect, Random, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { Unavailable } from '../outcome/unavailable.ts';
import { alpha, askedOf, contentWith, json, notKeptNow, notReadNow } from '../payload-testing/payload-samples.ts';
import { firstTryAgainMs, mostTryAgainMs, payloadGateOf, tryAgainAfter } from './payload-gate.ts';
import { payloadKept } from './payload-keeping.ts';
import { payloadReaderOf } from './payload-reader.ts';

const now = Date.parse('2026-11-10T09:00:00.000Z');

const unanswered = new Unavailable({ detail: 'no answer' });

const halfTheWait: Random.Random = { nextIntUnsafe: () => 0, nextDoubleUnsafe: () => 0 };

function outcomeAt<A, E>(moment: number, effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return at(moment, Effect.result(effect).pipe(Effect.provideService(Random.Random, halfTheWait)));
}

function countingCalls(answers: readonly ('fail' | 'answer')[]) {
  let calls = 0;
  const call = Effect.suspend(() => {
    calls += 1;
    return answers[Math.min(calls, answers.length) - 1] === 'fail'
      ? Effect.fail(unanswered)
      : Effect.succeed('answered');
  });
  return { call, calls: () => calls };
}

describe('the wait of the gate after failures in a row', () => {
  it('waits between half and all of a second after a failure, then twice as long after each failure in a row, at most a minute', () => {
    const waits = [1, 2, 3, 7, 8].map((failures) => [tryAgainAfter(failures, 0), tryAgainAfter(failures, 1)]);

    expect(waits).toEqual([
      [500, 1000],
      [1000, 2000],
      [2000, 4000],
      [30_000, mostTryAgainMs],
      [30_000, mostTryAgainMs],
    ]);
    expect(firstTryAgainMs).toBe(1000);
  });

  it('waits at most as long as a caller names, on the same schedule, where it names a longer wait than a minute', () => {
    const fiveMinutes = 300_000;

    const waits = [7, 9, 10].map((failures) => [
      tryAgainAfter(failures, 0, fiveMinutes),
      tryAgainAfter(failures, 1, fiveMinutes),
    ]);

    expect(waits).toEqual([
      [32_000, 64_000],
      [128_000, 256_000],
      [150_000, fiveMinutes],
    ]);
  });
});

describe('the gate a process puts before its content store', () => {
  it('answers unavailable without asking the store while it is closed after a failure, and asks it again once its wait is over', async () => {
    const gate = payloadGateOf();
    const store = countingCalls(['fail', 'answer']);

    const outcomes = [
      await outcomeAt(now, gate.through(store.call, 'closed')),
      await outcomeAt(now + 499, gate.through(store.call, 'closed')),
      await outcomeAt(now + 500, gate.through(store.call, 'closed')),
    ];

    expect(outcomes).toEqual([
      Result.fail(unanswered),
      Result.fail(new Unavailable({ detail: 'closed' })),
      Result.succeed('answered'),
    ]);
    expect(store.calls()).toBe(2);
  });

  it('opens at once on any answer, a failure that is not the store’s among them, so the next failure waits as a first one', async () => {
    const gate = payloadGateOf();
    const store = countingCalls(['fail', 'fail', 'fail']);

    await outcomeAt(now, gate.through(store.call, 'closed'));
    const missing = await outcomeAt(now + 500, gate.through(Effect.fail('missing'), 'closed'));
    await outcomeAt(now + 500, gate.through(store.call, 'closed'));
    const afterAFirstWait = await outcomeAt(now + 1000, gate.through(store.call, 'closed'));

    expect(missing).toEqual(Result.fail('missing'));
    expect([afterAFirstWait, store.calls()]).toEqual([Result.fail(unanswered), 3]);
  });
});

describe('the gate, closed after failures in a row and given to the reads and puts of payloads', () => {
  it('waits twice as long after two failures in a row', async () => {
    const gate = payloadGateOf();
    const store = countingCalls(['fail', 'fail', 'answer']);

    await outcomeAt(now, gate.through(store.call, 'closed'));
    await outcomeAt(now + 500, gate.through(store.call, 'closed'));
    const stillClosed = await outcomeAt(now + 1499, gate.through(store.call, 'closed'));
    const answered = await outcomeAt(now + 1500, gate.through(store.call, 'closed'));

    expect([stillClosed, answered, store.calls()]).toEqual([
      Result.fail(new Unavailable({ detail: 'closed' })),
      Result.succeed('answered'),
      3,
    ]);
  });

  it('is shared by the reads and the puts of payloads it is given to, so a failed read keeps a put from the store too', async () => {
    const gate = payloadGateOf();
    const unreachableOnce = askedOf({ reads: [contentOfText(json.text, json.mediaType)] });
    const failingGet = { ...unreachableOnce.content, get: () => Effect.die(new Error('connect ECONNREFUSED')) };
    const reader = payloadReaderOf({ owner: alpha, content: failingGet, gate });
    const content = await contentWith();

    const read = await outcomeAt(now, reader.text(json));
    const put = await outcomeAt(now + 1, payloadKept(content, alpha, json, { gate }));

    expect([read, put]).toEqual([Result.fail(notReadNow), Result.fail(notKeptNow)]);
    expect(await Effect.runPromise(content.get(alpha, json.sha256))).toBeUndefined();
  });
});
