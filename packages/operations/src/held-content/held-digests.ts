import { JsonPointer as Pointers, Predicate } from 'effect';

import type { TypedEvent } from '../ledger/decider.ts';
import type { ContentDeclaration, ContentHolders, JsonPointer } from './content-declaration.ts';

export type HeldDigests = ReadonlyMap<string, number>;

const aDigest = /^[0-9a-f]{64}$/u;

function valueAt(data: unknown, pointer: JsonPointer): unknown {
  return pointer
    .slice(1)
    .split('/')
    .reduce<unknown>((value, segment) => {
      const token = Pointers.unescapeToken(segment);
      return Predicate.isObjectOrArray(value) && Object.hasOwn(value, token) ? Reflect.get(value, token) : undefined;
    }, data);
}

export function digestsNamed(data: unknown, pointers: readonly JsonPointer[]): readonly string[] {
  return pointers.flatMap((pointer) => {
    const value = valueAt(data, pointer);
    return typeof value === 'string' && aDigest.test(value) ? [value] : [];
  });
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

function heldBy({ holds = [] }: ContentDeclaration, held: HeldDigests, data: unknown): HeldDigests {
  const after = new Map(held);
  for (const digest of digestsNamed(data, holds)) {
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
  const { holds = [], releases = [] } = holders.get(type) ?? {};
  return digestsNamed(data, [...holds, ...(releases === 'all' ? [] : releases)]);
}

export function digestsChanged(before: HeldDigests, after: HeldDigests): readonly string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((digest) => before.get(digest) !== after.get(digest))
    .toSorted();
}
