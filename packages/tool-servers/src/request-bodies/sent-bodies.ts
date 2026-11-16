import { randomUUID } from 'node:crypto';

import { Predicate, Result } from 'effect';

import type { NamedPart, OrderedParts, SentBody } from './body-places.ts';
import { sentAt, type SentPart } from './file-places.ts';

interface SentContent {
  readonly contentType: string;
  readonly content: Readonly<Uint8Array>;
}

type Sending<A> = Result.Result<A, string>;

interface Positioned {
  readonly item: unknown;
  readonly index: number;
}

interface Framed {
  readonly headers: readonly string[];
  readonly text: string;
}

const encoder = new TextEncoder();

const lineBreak = '\r\n';

const noPart = 'The argument /body gives no part, and a body of parts needs one at least';

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function formName(name: string): string {
  return name.replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll('"', '%22');
}

function multipartOf(mediaType: string, framed: readonly Framed[]): SentContent {
  const boundary = `auto-${randomUUID()}`;
  const parts = framed.map(
    ({ headers, text }) =>
      `--${boundary}${lineBreak}${headers.join(lineBreak)}${lineBreak}${lineBreak}${text}${lineBreak}`,
  );
  return {
    contentType: `${mediaType}; boundary=${boundary}`,
    content: encoder.encode(`${parts.join('')}--${boundary}--${lineBreak}`),
  };
}

function typed({ mediaType, text }: SentPart): Framed {
  return { headers: [`Content-Type: ${mediaType}`], text };
}

function eachSent<A>(items: readonly A[], send: (item: A) => Sending<Framed>): Sending<readonly Framed[]> {
  const framed: Framed[] = [];
  for (const item of items) {
    const sent = send(item);
    if (Result.isFailure(sent)) {
      return Result.fail(sent.failure);
    }
    framed.push(sent.success);
  }
  return framed.length === 0 ? Result.fail(noPart) : Result.succeed(framed);
}

function partsInWords(count: number): string {
  return count === 1 ? '1 part' : `${count} parts`;
}

function tooMany(count: number, most: number): string {
  return `The argument /body holds ${partsInWords(count)}, and this operation takes at most ${most}; leave out the parts past those`;
}

function countRefusal(count: number, { least, most }: OrderedParts): string | undefined {
  if (count < least) {
    return `The argument /body holds ${partsInWords(count)}, and this operation takes at least ${least}; give every part its input_schema lists, in order`;
  }
  return most !== undefined && count > most ? tooMany(count, most) : undefined;
}

function orderedPart(parts: OrderedParts, count: number) {
  return ({ item, index }: Positioned): Sending<Framed> => {
    const place = parts.parts[index] ?? parts.after;
    return place === undefined
      ? Result.fail(tooMany(count, parts.parts.length))
      : Result.map(sentAt(place, item, `/body/${index}`), typed);
  };
}

function orderedOf(parts: OrderedParts, value: unknown): Sending<SentContent> {
  if (!Array.isArray(value)) {
    return Result.fail(
      'The argument /body is not a list, and this operation takes its parts as a list, one item per part, in order',
    );
  }
  const refusal = countRefusal(value.length, parts);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const given = value.map((item: unknown, index): Positioned => ({ item, index }));
  return Result.map(eachSent(given, orderedPart(parts, value.length)), (each) => multipartOf(parts.mediaType, each));
}

function namedOf(mediaType: string, parts: readonly NamedPart[], value: unknown): Sending<SentContent> {
  if (!isPlainObject(value)) {
    return Result.fail(
      'The argument /body is not an object, and this operation takes its parts as an object, one property per part',
    );
  }
  const names = new Set(parts.map(({ name }) => name));
  const unknown = Object.keys(value).find((name) => !names.has(name));
  if (unknown !== undefined) {
    return Result.fail(`The argument /body/${unknown} names no part of the body of this operation`);
  }
  const given = parts.filter(({ name }) => value[name] !== null && value[name] !== undefined);
  const framed = eachSent(given, ({ name, place }) =>
    Result.map(sentAt(place, value[name], `/body/${name}`), (sent) => ({
      headers: [`Content-Disposition: form-data; name="${formName(name)}"`, ...typed(sent).headers],
      text: sent.text,
    })),
  );
  return Result.map(framed, (each) => multipartOf(mediaType, each));
}

export function sentContentOf(body: SentBody, value: unknown): Sending<SentContent> {
  if (body.kind === 'file') {
    return Result.map(sentAt(body.place, value, '/body'), ({ mediaType, text }) => ({
      contentType: mediaType,
      content: encoder.encode(text),
    }));
  }
  return body.kind === 'named_parts' ? namedOf(body.mediaType, body.parts, value) : orderedOf(body, value);
}
