import { sizeInWords } from '@on.auto/phrasing';
import { Effect, JsonPointer, Option, Predicate, Schema } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { assetContentOf, assetsIn, type PlacedAsset } from './asset-references.ts';
import type { AssetHolding, HeldAsset } from './held-assets.ts';

type ReadUnit = 'characters' | 'bytes';

export interface ReaderBound {
  readonly most: number;
  readonly unit: ReadUnit;
  readonly reader: string;
  readonly remedy: string;
}

export interface InsideReading {
  readonly holding: AssetHolding;
  readonly playbook: PlaybookAddress;
  readonly bound: ReaderBound;
}

export interface AssetNotRead {
  readonly because: 'asset_unusable' | 'too_large' | 'not_a_value';
  readonly pointer: string;
  readonly detail: string;
}

type ReadAt = (pointer: string) => boolean;

const contentWords: Readonly<Record<'text' | 'json', string>> = { text: 'text', json: 'JSON value' };

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function notRead(
  because: AssetNotRead['because'],
  pointer: string,
  detail: string,
): Effect.Effect<never, AssetNotRead> {
  return Effect.fail({ because, pointer, detail });
}

const counted = new Intl.NumberFormat('en');

function boundInWords({ most, unit, reader }: ReaderBound): string {
  return `${unit === 'bytes' ? sizeInWords(most) : `${counted.format(most)} characters`} ${reader}`;
}

function tooLarge(
  pointer: string,
  held: HeldAsset,
  bound: ReaderBound,
  readSoFar: number,
): Effect.Effect<never, AssetNotRead> {
  const content = held.content === 'json' ? contentWords.json : contentWords.text;
  const kept = `The input at ${pointer} is a kept ${content} of ${counted.format(held.bytes)} bytes`;
  const past = `more than the ${boundInWords(bound)}; ${bound.remedy}`;
  return notRead(
    'too_large',
    pointer,
    readSoFar === 0
      ? `${kept}, ${past}`
      : `${kept}, which with the ${counted.format(readSoFar)} ${bound.unit} of kept values this step read before it is ${past}`,
  );
}

type Read = { readonly text: string } | 'too_large';

async function textReadIn(stream: ReadableStream<Uint8Array>, unit: ReadUnit, room: number): Promise<Read> {
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  const isPastTheRoom = () => (unit === 'bytes' ? bytes : text.length) > room;
  for await (const piece of stream) {
    bytes += piece.byteLength;
    text += decoder.decode(piece, { stream: true });
    if (isPastTheRoom()) {
      return 'too_large';
    }
  }
  text += decoder.decode();
  return isPastTheRoom() ? 'too_large' : { text };
}

function valueOf(pointer: string, held: HeldAsset, text: string): Effect.Effect<Schema.Json, AssetNotRead> {
  if (held.content === 'text') {
    return Effect.succeed(text);
  }
  return Option.match(decodeJson(text), {
    onSome: (decoded) => Effect.succeed(decoded),
    onNone: () =>
      notRead(
        'not_a_value',
        pointer,
        `The input at ${pointer} is an asset of ${held.mediaType} that holds no JSON value, so it cannot be read as one; read a kept JSON value only where it holds one, and pass this asset on whole`,
      ),
  });
}

function unreadable(pointer: string, detail: string): AssetNotRead {
  return {
    because: 'asset_unusable',
    pointer,
    detail: `The input at ${pointer} names an asset that cannot be read: ${detail}`,
  };
}

function heldAt(reading: InsideReading, { pointer, reference }: PlacedAsset) {
  if (reference === undefined) {
    return notRead(
      'asset_unusable',
      pointer,
      `The input at ${pointer} holds the members of an asset without being one; give an asset as the run that made it answered it`,
    );
  }
  return Effect.mapError(reading.holding.held(reading.playbook, reference), ({ detail }) =>
    unreadable(pointer, detail),
  );
}

interface Reads {
  readonly left: number;
  readonly bySha256: ReadonlyMap<string, Schema.Json>;
  readonly byPointer: ReadonlyMap<string, Schema.Json>;
}

interface ValueRead {
  readonly pointer: string;
  readonly sha256: string;
  readonly value: Schema.Json;
  readonly spent: number;
}

function withRead(reads: Reads, { pointer, sha256, value, spent }: ValueRead): Reads {
  return {
    left: reads.left - spent,
    bySha256: new Map([...reads.bySha256, [sha256, value]]),
    byPointer: new Map([...reads.byPointer, [pointer, value]]),
  };
}

function contentRead(reading: InsideReading, pointer: string, held: HeldAsset, reads: Reads) {
  const { bound } = reading;
  const readBefore = reads.bySha256.get(held.sha256);
  if (readBefore !== undefined) {
    return Effect.succeed(withRead(reads, { pointer, sha256: held.sha256, value: readBefore, spent: 0 }));
  }
  const readSoFar = bound.most - reads.left;
  if (bound.unit === 'bytes' && held.bytes > reads.left) {
    return tooLarge(pointer, held, bound, readSoFar);
  }
  return Effect.gen(function* () {
    const stream = yield* Effect.mapError(held.opened(), ({ detail }) => unreadable(pointer, detail));
    const read = yield* Effect.promise(() => textReadIn(stream, bound.unit, reads.left));
    if (read === 'too_large') {
      return yield* tooLarge(pointer, held, bound, readSoFar);
    }
    const value = yield* valueOf(pointer, held, read.text);
    const spent = bound.unit === 'bytes' ? held.bytes : read.text.length;
    return withRead(reads, { pointer, sha256: held.sha256, value, spent });
  });
}

function isAFile({ shaped }: PlacedAsset): boolean {
  const mediaType = shaped['media_type'];
  return typeof mediaType === 'string' && assetContentOf(mediaType) === 'file';
}

function readAlso(reading: InsideReading, reads: Reads, placed: PlacedAsset): Effect.Effect<Reads, AssetNotRead> {
  if (isAFile(placed)) {
    return Effect.succeed(reads);
  }
  return Effect.flatMap(heldAt(reading, placed), (held) =>
    held.content === 'file' ? Effect.succeed(reads) : contentRead(reading, placed.pointer, held, reads),
  );
}

function isRecord(value: Schema.Json): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function withValuesAt(value: Schema.Json, read: ReadonlyMap<string, Schema.Json>, pointer: string): Schema.Json {
  const found = read.get(pointer);
  if (found !== undefined) {
    return found;
  }
  if (Array.isArray(value)) {
    return value.map((item: Schema.Json, index) => withValuesAt(item, read, `${pointer}/${index}`));
  }
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, member]: readonly [string, Schema.Json]) => [
          key,
          withValuesAt(member, read, `${pointer}/${JsonPointer.escapeToken(key)}`),
        ]),
      )
    : value;
}

export function readInside(
  value: Schema.Json,
  readAt: ReadAt,
  reading: InsideReading,
): Effect.Effect<Schema.Json, AssetNotRead> {
  const placed = assetsIn(value).filter(({ pointer }) => readAt(pointer));
  if (placed.length === 0) {
    return Effect.succeed(value);
  }
  const nothingRead: Reads = { left: reading.bound.most, bySha256: new Map(), byPointer: new Map() };
  return Effect.map(
    Effect.reduce(
      placed,
      () => nothingRead,
      (reads, each) => readAlso(reading, reads, each),
    ),
    ({ byPointer }) => (byPointer.size === 0 ? value : withValuesAt(value, byPointer, '')),
  );
}
