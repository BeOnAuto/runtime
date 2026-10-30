import { Effect, Function } from 'effect';

import { chunkerOf } from './content-chunks.ts';
import { sha256Digest } from './content-digest.ts';
import { notItsDigest, notItsSize, streamFailed, type ContentRefused } from './content-refusals.ts';
import type { Digested } from './recorded-content.ts';
import type { ExpectedContent } from './streamed-content.ts';

export interface Taken extends Digested {
  readonly chunks: number;
}

export type TakeChunk = (chunk: Readonly<Uint8Array<ArrayBuffer>>, index: number) => Effect.Effect<void>;

export function takenInChunks(
  stream: ReadableStream<Uint8Array>,
  chunkBytes: number,
  take: TakeChunk,
): Effect.Effect<Taken, ContentRefused> {
  return Effect.suspend(() => {
    const reader = stream.getReader();
    const chunker = chunkerOf(chunkBytes);
    const digest = sha256Digest();
    let bytes = 0;
    let chunks = 0;
    const takenEach = (whole: readonly Readonly<Uint8Array<ArrayBuffer>>[]) =>
      Effect.forEach(
        whole,
        (chunk) => {
          digest.update(chunk);
          bytes += chunk.byteLength;
          chunks += 1;
          return take(chunk, chunks - 1);
        },
        { discard: true },
      );
    const pulled = Effect.tryPromise({ try: () => reader.read(), catch: streamFailed });
    return Effect.gen(function* () {
      let read = yield* pulled;
      while (!read.done) {
        yield* takenEach(chunker.filled(read.value));
        read = yield* pulled;
      }
      yield* takenEach(chunker.rest());
      const taken: Taken = { sha256: digest.hex(), bytes, chunks };
      return taken;
    }).pipe(Effect.onError(() => Effect.promise(() => reader.cancel().catch(Function.constVoid))));
  });
}

export function requireExpected(
  expected: ExpectedContent | undefined,
  found: Digested,
): Effect.Effect<void, ContentRefused> {
  if (expected?.bytes !== undefined && expected.bytes !== found.bytes) {
    return Effect.fail(notItsSize({ sha256: found.sha256, bytes: found.bytes }, expected.bytes));
  }
  if (expected?.sha256 !== undefined && expected.sha256 !== found.sha256) {
    return Effect.fail(notItsDigest({ sha256: found.sha256, bytes: found.bytes }, expected.sha256));
  }
  return Effect.void;
}

export function leftUnread(stream: ReadableStream<Uint8Array>): Effect.Effect<void> {
  return Effect.promise(() => stream.cancel());
}
