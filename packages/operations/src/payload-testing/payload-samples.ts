import {
  sha256Of,
  type Digested,
  type KeptContentHead,
  type RecordedContent,
  type StreamedContent,
} from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { Effect, Fiber, Function } from 'effect';
import { TestClock } from 'effect/testing';

import { Unavailable } from '../outcome/unavailable.ts';
import { payloadKept } from '../payloads/payload-keeping.ts';
import { PayloadMissing } from '../payloads/payload-missing.ts';
import { payloadReaderOf, type PayloadNotRead, type PayloadSource } from '../payloads/payload-reader.ts';
import { jsonPayloadText, textBytesOf, textPayloadText, type PayloadToKeep } from '../payloads/payload-texts.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';

export type ReadContent = PayloadSource['content'];

export const alpha = { org: 'acme', playbook: 'alpha' };

export const value = { lead: 'lead-1', notes: 'n'.repeat(3000) };

export const notReadNow = new Unavailable({
  detail: 'A large value the playbook keeps could not be read just now; try again in a moment',
});

export const notKeptNow = new Unavailable({
  detail: 'A large value could not be kept just now; try again in a moment',
});

export function keptFor(text: string): PayloadToKeep {
  return { ...textPayloadText(text), sha256: sha256Of(text), bytes: textBytesOf(text) };
}

export const json = keptFor(jsonPayloadText(value).text);

export function digestedOf({ sha256, bytes }: Readonly<PayloadToKeep>): Digested {
  return { sha256, bytes };
}

export function contentWith(...texts: readonly PayloadToKeep[]): Promise<RecordedContent> {
  const { content } = memoryLedger().service;
  return Effect.runPromise(
    Effect.as(
      Effect.forEach(texts, (toKeep) => payloadKept(content, alpha, toKeep)),
      content,
    ),
  );
}

export function readerOver(content: ReadContent, readsAtOnce?: number) {
  return payloadReaderOf({ owner: alpha, content, ...(readsAtOnce === undefined ? {} : { readsAtOnce }) });
}

export function failureOf<A>(effect: Effect.Effect<A, PayloadNotRead>): Promise<PayloadNotRead> {
  return Effect.runPromise(Effect.flip(effect));
}

export function failureAt<A>(moment: number, effect: Effect.Effect<A, PayloadNotRead>): Promise<PayloadNotRead> {
  return at(moment, Effect.flip(effect));
}

export function missingOf(sha256: string, because: PayloadMissing['because'], said: string): PayloadMissing {
  return new PayloadMissing({ ...alpha, sha256, because, message: `The payload kept under ${sha256} ${said}` });
}

interface Answers {
  readonly reads: readonly (StreamedContent | undefined)[];
  readonly head?: KeptContentHead;
}

interface Asked {
  readonly content: ReadContent;
  readonly gets: () => number;
}

export function askedOf({ reads, head }: Answers): Asked {
  let gets = 0;
  return {
    content: {
      get: () =>
        Effect.sync(() => {
          gets += 1;
          return reads[Math.min(gets, reads.length) - 1];
        }),
      getHead: () => Effect.succeed(head),
    },
    gets: () => gets,
  };
}

export function answering(content: StreamedContent): ReadContent {
  return askedOf({ reads: [content] }).content;
}

export function failingStream(failure: Readonly<Error>, bytes: number): StreamedContent {
  return {
    stream: new ReadableStream({
      pull: (controller) => {
        controller.error(failure);
      },
    }),
    bytes,
    mediaType: 'application/json',
  };
}

interface Watched {
  readonly content: StreamedContent;
  readonly reached: Promise<void>;
  readonly pulls: () => number;
  readonly cancelled: () => boolean;
}

type Pull = (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void> | void;

export function watchedStream(bytes: number, pull: Pull): Watched {
  const reached = Promise.withResolvers<void>();
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        pulls += 1;
        reached.resolve();
        return pull(controller);
      },
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    content: { stream, bytes, mediaType: 'application/json' },
    reached: reached.promise,
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
}

export function hanging(): Promise<void> {
  return new Promise(Function.constVoid);
}

export function endless(controller: ReadableStreamDefaultController<Uint8Array>): void {
  controller.enqueue(new Uint8Array(1024));
}

export function afterWaiting<A, E>(waiting: Effect.Effect<A, E>, ms: number, reached: Promise<void>): Promise<E | A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(waiting));
      yield* Effect.promise(() => reached);
      yield* TestClock.adjust(ms);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

export function oneHangingAndOneUnheld(watched: Watched, hung: string): ReadContent {
  return {
    get: (_owner, sha256) =>
      sha256 === hung
        ? Effect.succeed(watched.content)
        : Effect.map(
            Effect.promise(() => watched.reached),
            Function.constUndefined,
          ),
    getHead: () => Effect.undefined,
  };
}

interface Counted {
  readonly content: ReadContent;
  readonly mostAtOnce: () => number;
}

export function countedOver(content: RecordedContent): Counted {
  let reading = 0;
  let mostAtOnce = 0;
  return {
    content: {
      get: (owner, sha256) =>
        Effect.gen(function* () {
          reading += 1;
          mostAtOnce = Math.max(mostAtOnce, reading);
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
          reading -= 1;
          return yield* content.get(owner, sha256);
        }),
      getHead: content.getHead,
    },
    mostAtOnce: () => mostAtOnce,
  };
}

export const unreachable: ReadContent = {
  get: () => Effect.die(new Error('connect ECONNREFUSED')),
  getHead: () => Effect.die(new Error('connect ECONNREFUSED')),
};
