import {
  assetsIn,
  type AssetHolding,
  type HeldAsset,
  type PlacedAsset,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Effect, JsonPointer, type Schema } from 'effect';

import { argumentsTooLarge } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { base64Bytes, bytesRead, encodedAs } from './encoded-pieces.ts';
import { jsonSyntaxCheck, type JsonFound } from './json-syntax.ts';
import { declaredAt, type PlaceDeclared } from './schema-places.ts';
import { encodingOf, type SentEncoding } from './sent-encodings.ts';

type Place = readonly [string, ...string[]];

export interface SentAsset {
  readonly pointer: string;
  readonly place: Place;
  readonly encoding: SentEncoding;
  readonly bytes: number;
  readonly held: HeldAsset;
}

export interface AssetsPlanned {
  readonly sent: readonly SentAsset[];
  readonly requestBytes: number;
}

type NotSentBecause = 'asset_unusable' | 'asset_not_taken' | 'too_large';

export interface AssetsNotSent {
  readonly because: NotSentBecause;
  readonly pointer: string;
  readonly detail: string;
  readonly requestBytes?: number;
}

export interface AssetPlanning {
  readonly holding: AssetHolding;
  readonly playbook: PlaybookAddress;
  readonly inputSchema: Schema.JsonObject;
  readonly tool: string;
  readonly mostBytes: number;
}

export const mostDepthOfAValue = 512;

const fileWhereText =
  'a tool takes a file where its schema says format: byte or contentEncoding: base64; send it to a tool that takes one';

const kindsTaken =
  'a tool takes a text where its schema says string, a JSON value where it says object or array, and a file where it says format: byte or contentEncoding: base64; send it where the tool takes that kind, or to a tool that does';

function notSent(because: NotSentBecause, pointer: string, detail: string): Effect.Effect<never, AssetsNotSent> {
  return Effect.fail({ because, pointer, detail });
}

function notTakenWords({ pointer, held, tool }: Placing, declared: PlaceDeclared): string {
  const takesText = declared.types === 'any' || declared.types.has('string');
  return held.content === 'file' && takesText
    ? `The argument ${pointer} is a file of ${held.mediaType}, and ${tool} takes text there; ${fileWhereText}`
    : `The argument ${pointer} is an asset of ${held.mediaType}, of a kind ${tool} does not take there; ${kindsTaken}`;
}

interface Placing {
  readonly pointer: string;
  readonly held: HeldAsset;
  readonly tool: string;
}

function unusableWords(pointer: string, detail: string): string {
  return `The argument ${pointer} names an asset that cannot be sent: ${detail}`;
}

function opened({ pointer, held }: Placing): Effect.Effect<ReadableStream<Uint8Array>, AssetsNotSent> {
  return Effect.mapError(held.opened(), ({ detail }) => ({
    because: 'asset_unusable' as const,
    pointer,
    detail: unusableWords(pointer, detail),
  }));
}

type JsonRead = JsonFound | 'not_utf8';

async function jsonReadIn(stream: ReadableStream<Uint8Array>): Promise<JsonRead> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const check = jsonSyntaxCheck(mostDepthOfAValue);
  try {
    for await (const piece of stream) {
      check.take(decoder.decode(piece, { stream: true }));
    }
    check.take(decoder.decode());
  } catch {
    return 'not_utf8';
  }
  return check.ended();
}

const asTextWhere = (tool: string) => `send it where ${tool} takes a string, not an object or array`;

const notAValueWords: Readonly<Record<Exclude<JsonRead, 'one_value'>, (placing: Placing) => string>> = {
  not_one_value: ({ pointer, held, tool }) =>
    `The argument ${pointer} is an asset of ${held.mediaType} that holds no JSON value, so it is not sent as one; ${asTextWhere(tool)}`,
  too_deep: ({ pointer, held, tool }) =>
    `The argument ${pointer} is an asset of ${held.mediaType} whose JSON nests deeper than the ${mostDepthOfAValue} levels a value may, so it is not sent as one; ${asTextWhere(tool)}`,
  not_utf8: ({ pointer, held }) =>
    `The argument ${pointer} is an asset of ${held.mediaType} that is not UTF-8 text, so it is not sent as a JSON value; send it as a file, where a tool's schema says format: byte or contentEncoding: base64`,
};

function measuredJson(placing: Placing): Effect.Effect<number, AssetsNotSent> {
  return Effect.flatMap(opened(placing), (stream) =>
    Effect.flatMap(
      Effect.promise(() => jsonReadIn(stream)),
      (read) =>
        read === 'one_value'
          ? Effect.succeed(placing.held.bytes)
          : notSent('asset_not_taken', placing.pointer, notAValueWords[read](placing)),
    ),
  );
}

function measured(placing: Placing, encoding: SentEncoding): Effect.Effect<number, AssetsNotSent> {
  if (encoding === 'base64') {
    return Effect.succeed(base64Bytes(placing.held.bytes));
  }
  if (encoding === 'json') {
    return measuredJson(placing);
  }
  return Effect.flatMap(opened(placing), (stream) => Effect.promise(() => bytesRead(encodedAs('text', stream))));
}

function placeOf(pointer: string): Place | undefined {
  const [first, ...rest] = pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
  return first === undefined ? undefined : [first, ...rest];
}

function heldAt(planning: AssetPlanning, { pointer, reference }: PlacedAsset): Effect.Effect<HeldAsset, AssetsNotSent> {
  if (reference === undefined) {
    return notSent(
      'asset_unusable',
      pointer,
      `The argument ${pointer} holds the members of an asset without being one; give an asset as the run that made it answered it`,
    );
  }
  return Effect.mapError(planning.holding.held(planning.playbook, reference), ({ detail }) => ({
    because: 'asset_unusable' as const,
    pointer,
    detail: unusableWords(pointer, detail),
  }));
}

function sentOf(planning: AssetPlanning, placed: PlacedAsset): Effect.Effect<SentAsset, AssetsNotSent> {
  return Effect.gen(function* () {
    const place = placeOf(placed.pointer);
    if (place === undefined) {
      return yield* notSent(
        'asset_not_taken',
        '',
        'The arguments of this call are an asset as a whole; give it as one argument, where the tool takes it',
      );
    }
    const held = yield* heldAt(planning, placed);
    const placing: Placing = { pointer: placed.pointer, held, tool: planning.tool };
    const declared = declaredAt(planning.inputSchema, placed.pointer);
    const encoding = encodingOf(held.content, declared);
    if (encoding === undefined) {
      return yield* notSent('asset_not_taken', placed.pointer, notTakenWords(placing, declared));
    }
    const bytes = yield* measured(placing, encoding);
    return { pointer: placed.pointer, place, encoding, bytes, held };
  });
}

function argumentBytesWith(input: unknown, placed: readonly PlacedAsset[], sent: readonly SentAsset[]): number {
  const spliced = new Set(sent.map(({ pointer }) => pointer));
  const written = placed
    .filter(({ pointer }) => spliced.has(pointer))
    .reduce((total, { shaped }) => total + bytesOf(JSON.stringify(shaped)), 0);
  const sending = sent.reduce((total, { bytes }) => total + bytes, 0);
  return bytesOf(JSON.stringify(input)) - written + sending;
}

export function argumentBytesSent(input: unknown, sent: readonly SentAsset[]): number {
  return argumentBytesWith(input, assetsIn(input), sent);
}

export function plannedAssets(
  input: Readonly<Record<string, unknown>>,
  planning: AssetPlanning,
): Effect.Effect<AssetsPlanned, AssetsNotSent> {
  const placed = assetsIn(input);
  return Effect.flatMap(
    Effect.forEach(placed, (each) => sentOf(planning, each)),
    (sent: readonly SentAsset[]): Effect.Effect<AssetsPlanned, AssetsNotSent> => {
      const requestBytes = argumentBytesWith(input, placed, sent);
      return requestBytes > planning.mostBytes
        ? Effect.fail({
            because: 'too_large',
            pointer: '',
            detail: argumentsTooLarge(requestBytes, planning.mostBytes, sent.length > 0),
            requestBytes,
          })
        : Effect.succeed({ sent, requestBytes });
    },
  );
}
