import { sha256Of } from '@on.auto/content';
import { JsonPointer as Pointers } from 'effect';

import {
  everyElement,
  type ContentHolders,
  type JsonPointer,
  type PayloadPointers,
} from '../held-content/content-declaration.ts';
import type { Context } from '../ledger/context.ts';

export interface SampledFact {
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
}

interface InlineMember {
  readonly within: readonly string[];
  readonly name: string;
  readonly pointer: JsonPointer;
}

interface Twin {
  readonly payload: JsonPointer;
  readonly fact: SampledFact;
}

type Path = readonly string[];

const digestEnding = '_sha256';

const bytesEnding = '_bytes';

const utf8 = new TextEncoder();

function tokensOf(pointer: JsonPointer): Path {
  return pointer
    .slice(1)
    .split('/')
    .map((token) => Pointers.unescapeToken(token));
}

function inlineMemberOf({ sha256, bytes }: PayloadPointers): readonly InlineMember[] {
  const [digestTokens, sizeTokens] = [tokensOf(sha256), tokensOf(bytes)];
  const [digest, size] = [String(digestTokens.at(-1)), String(sizeTokens.at(-1))];
  const within = digestTokens.slice(0, -1);
  const name = digest.slice(0, -digestEnding.length);
  const isMember =
    digest.endsWith(digestEnding) &&
    size === `${name}${bytesEnding}` &&
    within.join('/') === sizeTokens.slice(0, -1).join('/');
  const pointer: JsonPointer = `/${[...within, name].map((token) => Pointers.escapeToken(token)).join('/')}`;
  return isMember ? [{ within, name, pointer }] : [];
}

export function inlineMembersOf(holders: ContentHolders, type: string): readonly InlineMember[] {
  const pointers = holders.get(type)?.payloads ?? [];
  return pointers.flatMap((pointer) => inlineMemberOf(pointer));
}

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function valueAt(data: unknown, path: Path): unknown {
  return path.reduce<unknown>((value, token) => (isContainer(value) ? Reflect.get(value, token) : undefined), data);
}

function parentsOf(data: unknown, within: Path): readonly Path[] {
  return within.reduce<readonly Path[]>(
    (paths, token) =>
      paths.flatMap((path) => {
        if (token !== everyElement) {
          return [path.concat(token)];
        }
        const list = valueAt(data, path);
        return Array.isArray(list) ? list.map((_, index) => path.concat(String(index))) : [];
      }),
    [[]],
  );
}

function holdsInline(data: unknown, path: Path, name: string): boolean {
  const parent = valueAt(data, path);
  return isContainer(parent) && Object.hasOwn(parent, name);
}

const sampledMember = 'sampled';

function noticing<Value extends object>(target: Value): Value {
  return new Proxy(target, {
    get: (object, key, receiver) => {
      if (typeof key === 'string' && !(key in object)) {
        return `${sampledMember} ${key}`;
      }
      const found: unknown = Reflect.get(object, key, receiver);
      return Object.hasOwn(object, key) && isContainer(found) ? noticing(found) : found;
    },
  });
}

function otherOfItsKind(value: unknown): unknown {
  if (typeof value === 'string') {
    return `${value} ${sampledMember}`;
  }
  if (typeof value === 'number') {
    return value + 1;
  }
  if (typeof value === 'boolean') {
    return !value;
  }
  return isContainer(value) ? noticing(value) : value;
}

type Changed = (parent: object, name: string) => void;

function keptOutside(parent: object, name: string): void {
  const text = JSON.stringify(Reflect.get(parent, name));
  Reflect.deleteProperty(parent, name);
  Reflect.set(parent, `${name}${digestEnding}`, sha256Of(text));
  Reflect.set(parent, `${name}${bytesEnding}`, utf8.encode(text).byteLength);
}

function changedToAnother(parent: object, name: string): void {
  Reflect.set(parent, name, otherOfItsKind(Reflect.get(parent, name)));
}

function twinChanged(fact: SampledFact, path: Path, name: string, changed: Changed): SampledFact {
  const data: unknown = structuredClone(fact.data);
  for (const parent of [valueAt(data, path)].filter((value): value is object => isContainer(value))) {
    changed(parent, name);
  }
  return { ...fact, data };
}

export function sampledInline(fact: SampledFact, { within, name }: InlineMember): readonly Path[] {
  return parentsOf(fact.data, within).filter((path) => holdsInline(fact.data, path, name));
}

export function twinsOf(fact: SampledFact, member: InlineMember): readonly Twin[] {
  return sampledInline(fact, member).flatMap((path) => [
    { payload: member.pointer, fact: twinChanged(fact, path, member.name, changedToAnother) },
    { payload: member.pointer, fact: twinChanged(fact, path, member.name, keptOutside) },
  ]);
}
