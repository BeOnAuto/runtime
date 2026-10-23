import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import type { InstanceSource } from '../instances/instance-source.ts';
import { folded, pageOf, viewOf } from '../pool-testing/fold-pages.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import type { FoldStall } from './fold-page.ts';

interface Folding {
  readonly view: Json;
  readonly stall?: FoldStall;
}

const considered = [0, 2, 3];

type InPages = (size: number, fold: string, view: Json, start?: number) => Promise<Folding>;

function inPagesOn(source: InstanceSource): InPages {
  const inPagesOf: InPages = async (size, fold, view, start = 0) => {
    const events = considered.slice(start, start + size);
    if (events.length === 0) {
      return { view };
    }
    const [result] = (await folded(source, pageOf([viewOf(fold, { view, events })]))).views;
    return result?.stall === undefined
      ? inPagesOf(size, fold, result?.view ?? null, start + size)
      : { view: result.view, stall: result.stall };
  };
  return inPagesOf;
}

function writingTo(holder: string): string {
  return [
    'export function fold(view) {',
    `  const holder = ${holder};`,
    '  holder.seen = (holder.seen ?? 0) + 1;',
    '  return { counts: [...view.counts, holder.seen] };',
    '}',
  ].join('\n');
}

const holders: readonly (readonly [string, string])[] = [
  ['the prototype of array iterators', 'Object.getPrototypeOf([][Symbol.iterator]())'],
  ['the prototype of map iterators', 'Object.getPrototypeOf(new Map()[Symbol.iterator]())'],
  ['the prototype of set iterators', 'Object.getPrototypeOf(new Set()[Symbol.iterator]())'],
  ['the prototype of string iterators', 'Object.getPrototypeOf(""[Symbol.iterator]())'],
  ['the prototype of the iterators of matchAll', 'Object.getPrototypeOf("".matchAll(/x/g))'],
  ['the prototype of generator functions', 'Object.getPrototypeOf(function* () {})'],
  ['the prototype of generators', 'Object.getPrototypeOf(function* () {}).prototype'],
  ['the prototype of async generator functions', 'Object.getPrototypeOf(async function* () {})'],
  ['the prototype of async generators', 'Object.getPrototypeOf(async function* () {}).prototype'],
  ['the prototype of async functions', 'Object.getPrototypeOf(async function () {})'],
  ['the prototype of iterator helpers', 'Object.getPrototypeOf([].values().map((each) => each))'],
  [
    'the prototype of wrapped iterators',
    'Object.getPrototypeOf(Iterator.from({ next: () => ({ done: true, value: undefined }) }))',
  ],
];

describe.each(sourcesUnderTest)('the intrinsics of a page that no global names on $name instances', ({ source }) => {
  const inPagesOf = inPagesOn(source);

  it.each(holders)(
    'are frozen with the rest, so a fold that writes to %s stalls at its first event in pages of one and of three',
    async (_holder, holder) => {
      const fold = writingTo(holder);

      const [one, three] = [await inPagesOf(1, fold, { counts: [] }), await inPagesOf(3, fold, { counts: [] })];

      expect(three).toMatchObject({ view: { counts: [] }, stall: { at: 0, kind: 'raised' } });
      expect(one).toEqual(three);
    },
  );
});

describe.each(sourcesUnderTest)('a fold in a frozen page on $name instances', ({ source }) => {
  const inPagesOf = inPagesOn(source);

  it('still iterates with helpers, generators, matchAll and the iterators of a Map and a Set', async () => {
    const iterating = [
      'export function fold(view) {',
      '  function* twice(values) {',
      '    for (const value of values) yield value * 2;',
      '  }',
      '  const doubled = [...twice([1, 2])];',
      '  const helped = [3, 4].values().map((value) => value + 1).toArray();',
      '  const matched = [..."a1b2".matchAll(/\\d/g)].map((found) => Number(found[0]));',
      '  const kept = [...new Map([[5, 6]]).values(), ...new Set([7])];',
      '  return [...view, doubled.length + helped.length + matched.length + kept.length];',
      '}',
    ].join('\n');

    expect([await inPagesOf(1, iterating, []), await inPagesOf(3, iterating, [])]).toEqual([
      { view: [8, 8, 8] },
      { view: [8, 8, 8] },
    ]);
  });
});

const droppedByJson: readonly (readonly [string, string, Json])[] = [
  [
    'two members that are one object',
    [
      'export function fold(view) {',
      '  if (view.a === undefined) {',
      '    const shared = { n: 0 };',
      '    return { a: shared, b: shared, aliased: 0 };',
      '  }',
      '  view.a.n += 1;',
      '  return { a: view.a, b: view.b, aliased: view.b.n };',
      '}',
    ].join('\n'),
    { a: { n: 2 }, b: { n: 0 }, aliased: 0 },
  ],
  [
    'a negative zero',
    [
      'export function fold(view) {',
      '  return { zero: -0, sign: view.zero === undefined ? null : String(1 / view.zero) };',
      '}',
    ].join('\n'),
    { zero: 0, sign: 'Infinity' },
  ],
  [
    'a member keyed by a symbol',
    [
      'export function fold(view) {',
      '  const seen = (view[Symbol.for("seen")] ?? 0) + 1;',
      '  return { [Symbol.for("seen")]: seen, seen };',
      '}',
    ].join('\n'),
    { seen: 1 },
  ],
];

describe.each(sourcesUnderTest)('the view a fold is handed on $name instances', ({ source }) => {
  const inPagesOf = inPagesOn(source);

  it.each(droppedByJson)(
    'is the JSON the last fold wrote, so %s it answered is gone in pages of one and of three',
    async (_dropped, fold, view) => {
      expect([await inPagesOf(1, fold, {}), await inPagesOf(3, fold, {})]).toEqual([{ view }, { view }]);
    },
  );
});
