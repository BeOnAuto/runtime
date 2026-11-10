import type { Digested } from '@on.auto/content';
import { JsonPointer as Pointers, Predicate } from 'effect';

import type { TypedEvent } from '../ledger/decider.ts';
import {
  everyElement,
  type ContentDeclaration,
  type ContentHolders,
  type JsonPointer,
  type PayloadPointers,
} from './content-declaration.ts';

export type HeldDigests = ReadonlyMap<string, number>;

const aDigest = /^[0-9a-f]{64}$/u;

type Elements = readonly number[];

function tokensOf(pointer: JsonPointer): readonly string[] {
  return pointer
    .slice(1)
    .split('/')
    .map((token) => Pointers.unescapeToken(token));
}

function memberOf(value: unknown, token: string): unknown {
  return Predicate.isObjectOrArray(value) && Object.hasOwn(value, token) ? Reflect.get(value, token) : undefined;
}

function elementsNamed(value: unknown, tokens: readonly string[], chosen: Elements = []): readonly Elements[] {
  const [token, ...rest] = tokens;
  if (token === undefined) {
    return [chosen];
  }
  if (token !== everyElement) {
    return elementsNamed(memberOf(value, token), rest, chosen);
  }
  return Array.isArray(value)
    ? value.flatMap((element: unknown, index) => elementsNamed(element, rest, [...chosen, index]))
    : [];
}

interface Walked {
  readonly value: unknown;
  readonly wildcards: number;
}

function valueAt(data: unknown, tokens: readonly string[], elements: Elements): unknown {
  return tokens.reduce<Walked>(
    ({ value, wildcards }, token) =>
      token === everyElement
        ? { value: memberOf(value, String(elements[wildcards])), wildcards: wildcards + 1 }
        : { value: memberOf(value, token), wildcards },
    { value: data, wildcards: 0 },
  ).value;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && aDigest.test(value);
}

export function digestsNamed(data: unknown, pointers: readonly JsonPointer[]): readonly string[] {
  return pointers.flatMap((pointer) => {
    const tokens = tokensOf(pointer);
    return elementsNamed(data, tokens).flatMap((elements) => {
      const value = valueAt(data, tokens, elements);
      return isDigest(value) ? [value] : [];
    });
  });
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function namedBy({ sha256, bytes }: PayloadPointers, data: unknown): readonly Digested[] {
  const [digestTokens, sizeTokens] = [tokensOf(sha256), tokensOf(bytes)];
  return elementsNamed(data, digestTokens).flatMap((elements) => {
    const digest = valueAt(data, digestTokens, elements);
    const size = valueAt(data, sizeTokens, elements);
    if (digest === undefined) {
      return [];
    }
    if (!isDigest(digest) || !isSize(size)) {
      throw new Error(
        `A payload of the fact is named by ${JSON.stringify(digest)} at ${sha256} beside ${JSON.stringify(size)} at ${bytes}, where a SHA-256 in lowercase hex and a whole number of bytes were expected`,
      );
    }
    return [{ sha256: digest, bytes: size }];
  });
}

export function payloadsNamed(data: unknown, { payloads = [] }: ContentDeclaration): readonly Digested[] {
  return payloads.flatMap((pointers) => namedBy(pointers, data));
}

export function payloadBytesOf(holders: ContentHolders, { type, data }: TypedEvent): number {
  const declaration = holders.get(type);
  return declaration === undefined
    ? 0
    : payloadsNamed(data, declaration).reduce((total, { bytes }) => total + bytes, 0);
}

function heldDigestsOf(declaration: ContentDeclaration, data: unknown): readonly string[] {
  return [
    ...digestsNamed(data, declaration.holds ?? []),
    ...payloadsNamed(data, declaration).map(({ sha256 }) => sha256),
  ];
}

function releasedBy({ releases = [] }: ContentDeclaration, held: HeldDigests, data: unknown): HeldDigests {
  if (releases === 'all') {
    return new Map();
  }
  const after = new Map(held);
  for (const digest of digestsNamed(data, releases)) {
    const left = (after.get(digest) ?? 0) - 1;
    if (left > 0) {
      after.set(digest, left);
    } else {
      after.delete(digest);
    }
  }
  return after;
}

function heldBy(declaration: ContentDeclaration, held: HeldDigests, data: unknown): HeldDigests {
  const after = new Map(held);
  for (const digest of heldDigestsOf(declaration, data)) {
    after.set(digest, (after.get(digest) ?? 0) + 1);
  }
  return after;
}

export function heldAfter(holders: ContentHolders, held: HeldDigests, { type, data }: TypedEvent): HeldDigests {
  const declaration = holders.get(type);
  return declaration === undefined ? held : heldBy(declaration, releasedBy(declaration, held, data), data);
}

export function heldOver(holders: ContentHolders, facts: readonly TypedEvent[], from: HeldDigests = new Map()) {
  return facts.reduce((held, fact) => heldAfter(holders, held, fact), from);
}

export function releasesEverything(holders: ContentHolders, { type }: TypedEvent): boolean {
  return holders.get(type)?.releases === 'all';
}

export function digestsTouchedBy(holders: ContentHolders, { type, data }: TypedEvent): readonly string[] {
  const declaration = holders.get(type);
  if (declaration === undefined) {
    return [];
  }
  const { releases = [] } = declaration;
  return [...heldDigestsOf(declaration, data), ...digestsNamed(data, releases === 'all' ? [] : releases)];
}

export function digestsChanged(before: HeldDigests, after: HeldDigests): readonly string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((digest) => before.get(digest) !== after.get(digest))
    .toSorted();
}
