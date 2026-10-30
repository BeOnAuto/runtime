import type { TakeChunk } from '@on.auto/operations';
import { Effect, Function } from 'effect';

import type { Bucket } from '../bucket/bucket.ts';

export interface UploadWriting {
  readonly take: TakeChunk;
  readonly uploading: () => boolean;
  readonly inHand: () => Readonly<Uint8Array>;
  readonly finished: () => Effect.Effect<void>;
  readonly abandoned: () => Effect.Effect<void>;
}

type Settled = { readonly sent: true } | { readonly sent: false; readonly failure: unknown };

interface Sending {
  readonly body: WritableStreamDefaultWriter<Uint8Array>;
  readonly settled: Promise<Settled>;
}

interface UploadTarget {
  readonly bucket: Bucket;
  readonly key: string;
  readonly mediaType: string;
}

function sentWhole(settled: Settled): void {
  if (!settled.sent) {
    throw settled.failure;
  }
}

function failedOrNever(settled: Settled): Promise<never> {
  sentWhole(settled);
  return new Promise<never>(Function.constVoid);
}

function whileSending<A>({ settled }: Sending, work: Promise<A>): Promise<A> {
  return Promise.race([work, settled.then(failedOrNever)]);
}

function sendingTo({ bucket, key, mediaType }: UploadTarget): Sending {
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const settled = bucket.put(key, { stream: body.readable, mediaType }).then(
    (): Settled => ({ sent: true }),
    (failure: unknown): Settled => ({ sent: false, failure }),
  );
  return { body: body.writable.getWriter(), settled };
}

export function uploadWritingOf(target: UploadTarget): UploadWriting {
  let held: Readonly<Uint8Array> | undefined;
  let sending: Sending | undefined;
  const sent = async (chunk: Readonly<Uint8Array>) => {
    sending ??= sendingTo(target);
    await whileSending(sending, sending.body.write(chunk));
  };
  const taken = async (chunk: Readonly<Uint8Array>) => {
    const first = held;
    held = sending === undefined && first === undefined ? chunk : undefined;
    if (first !== undefined) {
      await sent(first);
    }
    if (held === undefined) {
      await sent(chunk);
    }
  };
  return {
    take: (chunk) => Effect.promise(() => taken(chunk)),
    uploading: () => sending !== undefined,
    inHand: () => held ?? new Uint8Array(),
    finished: () =>
      Effect.promise(async () => {
        if (sending !== undefined) {
          await whileSending(sending, sending.body.close());
          sentWhole(await sending.settled);
        }
      }),
    abandoned: () =>
      Effect.promise(async () => {
        if (sending !== undefined) {
          void sending.body.abort(new Error('The content was not kept')).catch(Function.constVoid);
          await sending.settled;
          await target.bucket.delete([target.key]);
        }
      }),
  };
}
