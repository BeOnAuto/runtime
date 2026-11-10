import { ContentRefused, type RecordedContent } from '@on.auto/content';
import { memoryContentStore, pausableStore } from '@on.auto/content/testing';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { Unavailable } from '../outcome/unavailable.ts';
import { alpha, json, keptFor, notKeptNow, notReadNow, readerOver, value } from '../payload-testing/payload-samples.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { payloadKept } from './payload-keeping.ts';
import { payloadBytesASecond, payloadWaitMs, payloadWaitOf } from './payload-waits.ts';

const aMebibyte = keptFor('m'.repeat(1024 * 1024));

function contentPutting(put: RecordedContent['put']): Pick<RecordedContent, 'put'> {
  return { put };
}

function never<A>(): Effect.Effect<A> {
  return Effect.never;
}

interface Waited {
  readonly before: boolean;
  readonly after: Unavailable | undefined;
}

function waitedOut(keeping: Effect.Effect<void, Unavailable>, ms: number): Promise<Waited> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(keeping));
      yield* TestClock.adjust(ms - 1);
      const before = fiber.pollUnsafe() === undefined;
      yield* TestClock.adjust(1);
      return { before, after: yield* Fiber.join(fiber) };
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

function timedOutThenRead(content: RecordedContent, placing: Promise<void>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(payloadKept(content, alpha, json)));
      yield* Effect.promise(() => placing);
      yield* TestClock.adjust(payloadWaitOf(json.bytes));
      const failure = yield* Fiber.join(fiber);
      return [failure, yield* Effect.flip(readerOver(content).json(json))];
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

describe('the wait of a payload', () => {
  it(`is ${payloadWaitMs} ms, and a second more for each ${payloadBytesASecond} bytes of it`, () => {
    expect([
      payloadWaitOf(0),
      payloadWaitOf(json.bytes),
      payloadWaitOf(aMebibyte.bytes),
      payloadWaitOf(4 * 1024 * 1024),
    ]).toEqual([5000, 5000 + Math.ceil((json.bytes * 1000) / payloadBytesASecond), 9000, 21_000]);
  });
});

describe('a payload kept in the content of its playbook', () => {
  it('is put under its digest, so a read finds it there', async () => {
    const { content } = memoryLedger().service;
    await Effect.runPromise(payloadKept(content, alpha, json));

    expect(await Effect.runPromise(readerOver(content).json(json))).toEqual(value);
  });

  it('fails as a defect where the store finds its bytes are not the digest it was given', async () => {
    const { content } = memoryLedger().service;

    const defect = await Effect.runPromise(
      Effect.catchDefect(Effect.as(payloadKept(content, alpha, { ...json, sha256: 'a'.repeat(64) }), 'kept'), (died) =>
        Effect.succeed(died),
      ),
    );

    expect(defect).toMatchObject({ _tag: 'content_refused', because: 'not_its_digest' });
  });
});

describe('a payload not kept just now', () => {
  it('is unavailable where the store fails or refuses for now', async () => {
    const failing = contentPutting(() => Effect.die(new Error('connect ECONNREFUSED')));
    const refusingForNow = contentPutting(() =>
      Effect.fail(new ContentRefused({ because: 'unavailable', detail: 'being removed' })),
    );

    const failures = await Promise.all(
      [failing, refusingForNow].map((content) => Effect.runPromise(Effect.flip(payloadKept(content, alpha, json)))),
    );

    expect(failures).toEqual([notKeptNow, notKeptNow]);
  });

  it('is unavailable where the store has not answered within the wait for its size, which grows with it', async () => {
    const waited = [
      await waitedOut(payloadKept(contentPutting(never), alpha, json), payloadWaitOf(json.bytes)),
      await waitedOut(payloadKept(contentPutting(never), alpha, aMebibyte), payloadWaitOf(aMebibyte.bytes)),
    ];

    expect(waited).toEqual([
      { before: true, after: notKeptNow },
      { before: true, after: notKeptNow },
    ]);
  });

  it('leaves its content to be kept again where it was not kept in time, read meanwhile as unavailable and never as missing', async () => {
    const paused = pausableStore(memoryContentStore());
    const { content } = memoryLedger(undefined, [], undefined, paused.store).service;
    const placing = paused.pausedPlace();

    const timedOut = await timedOutThenRead(content, placing.reached);
    placing.release();
    await Effect.runPromise(payloadKept(content, alpha, json));

    expect(timedOut).toEqual([notKeptNow, notReadNow]);
    expect(await Effect.runPromise(readerOver(content).json(json))).toEqual(value);
  });
});
