import {
  NotTheBytesKept,
  sha256Digest,
  type ContentOwner,
  type Digested,
  type KeptContentHead,
  type RecordedContent,
  type Sha256Digest,
  type StreamedContent,
} from '@on.auto/content';
import { Clock, Effect, Function, Option, Schema } from 'effect';

import { keptContentGraceMs } from '../held-content/unheld-removal.ts';
import type { Unavailable } from '../outcome/unavailable.ts';
import { noPayloadCache, type PayloadCache } from './payload-cache.ts';
import { PayloadErased } from './payload-erased.ts';
import { noPayloadGate, type PayloadGate } from './payload-gate.ts';
import { PayloadMissing, type PayloadMissingBecause } from './payload-missing.ts';
import { unreachable, waitedFor } from './payload-waits.ts';

export const mostPayloadBytesReadAtOnce = 8 * 1024 * 1024;

export const payloadReadsAtOnce = 6;

export type PayloadNotRead = Unavailable | PayloadMissing | PayloadErased;

export interface PayloadReader {
  readonly json: (kept: Digested) => Effect.Effect<Schema.Json, PayloadNotRead>;
  readonly text: (kept: Digested) => Effect.Effect<string, PayloadNotRead>;
  readonly all: (kept: readonly Digested[]) => Effect.Effect<ReadonlyMap<string, string>, PayloadNotRead>;
}

export interface PayloadSource {
  readonly owner: ContentOwner;
  readonly content: Pick<RecordedContent, 'get' | 'getHead'>;
  readonly cache?: PayloadCache;
  readonly gate?: PayloadGate;
  readonly readsAtOnce?: number;
}

type BytesReader = ReadableStreamDefaultReader<Uint8Array>;

interface StreamRead {
  readonly bytes: number;
  readonly sha256: string;
  readonly text: string | undefined;
}

const notReadNow = 'A large value the playbook keeps could not be read just now; try again in a moment';

const missingBecause: Readonly<Record<PayloadMissingBecause, string>> = {
  not_held: "is not in the playbook's content",
  not_its_bytes: 'was read back as other bytes than its digest names',
  not_its_kind: 'is not text of the kind its fact names',
};

function missing({ org, playbook }: ContentOwner, sha256: string, because: PayloadMissingBecause): PayloadMissing {
  return new PayloadMissing({
    org,
    playbook,
    sha256,
    because,
    message: `The payload kept under ${sha256} ${missingBecause[because]}`,
  });
}

function answered<A>(asked: Effect.Effect<A>, sha256: string): Effect.Effect<A, Unavailable> {
  return Effect.catchDefect(asked, (defect) => unreachable(notReadNow, sha256, defect));
}

function goneOnPurpose(head: KeptContentHead | undefined, now: number): boolean {
  return head?.erasedAt !== undefined || (head?.expiresAt !== undefined && head.expiresAt <= now);
}

function erased({ org, playbook }: ContentOwner, sha256: string): PayloadErased {
  return new PayloadErased({
    org,
    playbook,
    sha256,
    message: `The payload kept under ${sha256} expired and was erased`,
  });
}

function notFoundTwice({ owner, content }: PayloadSource, sha256: string): Effect.Effect<never, PayloadNotRead> {
  return Effect.gen(function* () {
    const head = yield* answered(content.getHead(owner, sha256), sha256);
    const now = yield* Clock.currentTimeMillis;
    if (goneOnPurpose(head, now)) {
      return yield* Effect.fail(erased(owner, sha256));
    }
    if (head !== undefined && head.keptAt >= now - keptContentGraceMs) {
      return yield* unreachable(
        notReadNow,
        sha256,
        `not found twice, though its head was kept ${now - head.keptAt} ms ago`,
      );
    }
    return yield* Effect.fail(missing(owner, sha256, 'not_held'));
  });
}

function found(source: PayloadSource, sha256: string): Effect.Effect<StreamedContent, PayloadNotRead> {
  const asked = answered(source.content.get(source.owner, sha256), sha256);
  return Effect.gen(function* () {
    const read = (yield* asked) ?? (yield* asked);
    return read ?? (yield* notFoundTwice(source, sha256));
  });
}

interface Chunks {
  readonly add: (chunk: Readonly<Uint8Array>) => void;
  readonly decodedWhole: (bytes: number) => string | undefined;
}

interface Reading {
  readonly reader: BytesReader;
  readonly most: number;
  readonly digest: Sha256Digest;
  readonly chunks: Chunks;
}

function decodedWhole(chunks: readonly Readonly<Uint8Array>[], bytes: number): string | undefined {
  const whole = new Uint8Array(bytes);
  chunks.reduce((at, chunk) => {
    whole.set(chunk, at);
    return at + chunk.byteLength;
  }, 0);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(whole);
  } catch {
    return undefined;
  }
}

function chunksHeld(): Chunks {
  const held: Readonly<Uint8Array>[] = [];
  return {
    add: (chunk) => {
      held.push(chunk);
    },
    decodedWhole: (bytes) => decodedWhole(held, bytes),
  };
}

function readEnded({ digest, chunks }: Reading, bytes: number): StreamRead {
  return { bytes, sha256: digest.hex(), text: chunks.decodedWhole(bytes) };
}

async function readOn(reading: Reading, bytes: number): Promise<StreamRead> {
  const next = await reading.reader.read();
  if (next.done) {
    return readEnded(reading, bytes);
  }
  reading.digest.update(next.value);
  reading.chunks.add(next.value);
  const soFar = bytes + next.value.byteLength;
  return soFar > reading.most ? readEnded(reading, soFar) : readOn(reading, soFar);
}

function readThrough(reader: BytesReader, most: number): Promise<StreamRead> {
  return readOn({ reader, most, digest: sha256Digest(), chunks: chunksHeld() }, 0);
}

function textOfRead(owner: ContentOwner, kept: Digested, read: StreamRead): Effect.Effect<string, PayloadMissing> {
  if (read.bytes !== kept.bytes || read.sha256 !== kept.sha256) {
    return Effect.fail(missing(owner, kept.sha256, 'not_its_bytes'));
  }
  return read.text === undefined ? Effect.fail(missing(owner, kept.sha256, 'not_its_kind')) : Effect.succeed(read.text);
}

function textIn(
  owner: ContentOwner,
  kept: Digested,
  content: StreamedContent,
  reader: BytesReader,
): Effect.Effect<string, PayloadNotRead> {
  if (content.bytes !== kept.bytes) {
    return Effect.fail(missing(owner, kept.sha256, 'not_its_bytes'));
  }
  return Effect.tryPromise({ try: () => readThrough(reader, kept.bytes), catch: Function.identity }).pipe(
    Effect.catch((failure): Effect.Effect<never, PayloadNotRead> =>
      failure instanceof NotTheBytesKept
        ? Effect.fail(missing(owner, kept.sha256, 'not_its_bytes'))
        : unreachable(notReadNow, kept.sha256, failure),
    ),
    Effect.flatMap((read) => textOfRead(owner, kept, read)),
  );
}

function leftUnread(reader: BytesReader): Effect.Effect<void> {
  return Effect.sync(() => {
    reader.cancel().catch(Function.constVoid);
  });
}

function textRead(source: PayloadSource, kept: Digested): Effect.Effect<string, PayloadNotRead> {
  const read = Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(restore(found(source, kept.sha256)), (content) => {
      const reader = content.stream.getReader();
      return restore(textIn(source.owner, kept, content, reader)).pipe(Effect.ensuring(leftUnread(reader)));
    }),
  );
  const { gate = noPayloadGate } = source;
  return gate.through(waitedFor(read, kept.bytes, { detail: notReadNow, sha256: kept.sha256 }), notReadNow);
}

function cachedText(source: PayloadSource, kept: Digested): Effect.Effect<string, PayloadNotRead> {
  const { owner, cache = noPayloadCache } = source;
  return Effect.suspend(() => {
    const cached = cache.textOf(owner, kept.sha256);
    return cached === undefined
      ? Effect.tap(textRead(source, kept), (text) =>
          Effect.sync(() => {
            cache.kept(owner, kept.sha256, text);
          }),
        )
      : Effect.succeed(cached);
  });
}

function bounded<A>(
  kept: readonly Digested[],
  read: Effect.Effect<A, PayloadNotRead>,
): Effect.Effect<A, PayloadNotRead> {
  const bytes = kept.reduce((total, each) => total + each.bytes, 0);
  return bytes > mostPayloadBytesReadAtOnce
    ? Effect.die(
        new RangeError(`A read asked for ${bytes} bytes of payloads at once, more than ${mostPayloadBytesReadAtOnce}`),
      )
    : read;
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function jsonOf(source: PayloadSource, kept: Digested): Effect.Effect<Schema.Json, PayloadNotRead> {
  return Effect.flatMap(cachedText(source, kept), (text) =>
    Option.match(decodeJson(text), {
      onNone: () => Effect.fail(missing(source.owner, kept.sha256, 'not_its_kind')),
      onSome: (value) => Effect.succeed(value),
    }),
  );
}

function eachOnce(kept: readonly Digested[]): readonly Digested[] {
  return [...new Map(kept.map((each) => [each.sha256, each])).values()];
}

function allOf(
  source: PayloadSource,
  once: readonly Digested[],
): Effect.Effect<ReadonlyMap<string, string>, PayloadNotRead> {
  return Effect.forEach(once, (each) => Effect.map(cachedText(source, each), (text) => [each.sha256, text] as const), {
    concurrency: source.readsAtOnce ?? payloadReadsAtOnce,
  }).pipe(Effect.map((texts: readonly (readonly [string, string])[]) => new Map(texts)));
}

export function payloadReaderOf(source: PayloadSource): PayloadReader {
  return {
    json: (kept) => bounded([kept], jsonOf(source, kept)),
    text: (kept) => bounded([kept], cachedText(source, kept)),
    all: (kept) => {
      const once = eachOnce(kept);
      return bounded(once, allOf(source, once));
    },
  };
}
