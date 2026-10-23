import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { adding, byCampaign, folded, pageOf, runningClock, slowFirstFold, viewOf } from '../pool-testing/fold-pages.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { workerStackBytes } from '../programs/sandbox-bounds.ts';

const smallMemoryBytes = 16_777_216;

const memoryBomb =
  'export function fold() {\n  const kept = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);\n}';

const stallingFolds: readonly (readonly [string, string, Json, Readonly<Record<string, unknown>>])[] = [
  [
    'raises',
    'export function fold() {\n  throw new Error("no campaign");\n}',
    {},
    { kind: 'raised', message: 'Error: no campaign', line: 2 },
  ],
  [
    'overflows its stack',
    'export function fold(view) {\n  return fold(view + 1);\n}',
    {},
    { kind: 'raised', message: 'InternalError: stack overflow' },
  ],
  [
    'does too much work',
    'export function fold() {\n  for (;;) {}\n}',
    {},
    { kind: 'work', message: 'The program did more work than it may' },
  ],
  ['uses more memory than a page may', memoryBomb, {}, { kind: 'memory' }],
  [
    'answers a value too deep',
    'export function fold() {\n  let value = 0;\n  for (let level = 0; level < 600; level++) value = [value];\n  return value;\n}',
    {},
    { kind: 'unfit' },
  ],
  [
    'answers what JSON cannot carry',
    'export function fold() {\n  return 0 / 0;\n}',
    {},
    { kind: 'unfit', message: 'The answer holds NaN at $, which JSON cannot carry' },
  ],
  [
    'outgrows its bound',
    'export function fold() {\n  return "x".repeat(600000);\n}',
    {},
    { kind: 'size', message: 'The view takes more than the 524288 bytes as JSON a view may' },
  ],
  [
    'outgrows its bound in bytes, not characters',
    'export function fold() {\n  return "é".repeat(300000);\n}',
    {},
    { kind: 'size' },
  ],
  [
    'does not load',
    'export function fold(view) {\n  return view +;\n}',
    0,
    { kind: 'refused', message: expect.stringContaining('The fold does not load on this server: SyntaxError') },
  ],
  [
    'exports no fold',
    'export function answer(view) {\n  return view;\n}',
    0,
    { kind: 'refused', message: 'The fold does not load on this server: The program exports no function fold' },
  ],
  [
    'is written in syntax that is not erasable',
    'enum Color { Red }\nexport function fold(view) {\n  return view;\n}',
    0,
    { kind: 'refused', line: 1 },
  ],
  [
    'keeps state on its prototype, which is frozen',
    'export function fold(view) {\n  fold.prototype.seen = view;\n  return view + 1;\n}',
    0,
    { kind: 'raised' },
  ],
  [
    'keeps state on Math, which is frozen',
    'export function fold(view) {\n  Object.assign(Math, { seen: view });\n  return view + 1;\n}',
    0,
    { kind: 'raised' },
  ],
];

describe.each(sourcesUnderTest)('a view that stalls in a page of folds on $name instances', ({ source }) => {
  it.each(stallingFolds)(
    'stalls at the event when its fold %s, never folding another',
    async (_ending, fold, view, stall) => {
      const page = await folded(source, pageOf([viewOf(fold, { view }), viewOf(adding, { view: 0 })]));

      expect(page.views[0]).toMatchObject({ view, folded: 0, lastFolded: -1, stall: { at: 0, ...stall } });
      expect(page.views[1]).toMatchObject({ view: 3, folded: 3 });
    },
  );

  it('stalls a view whose initial value does not fit its sandbox, or whose context does not freeze in time', async () => {
    const page = await folded(
      source,
      pageOf([viewOf(adding, { view: 'x'.repeat(20_000_000) })], { memoryBytes: smallMemoryBytes }),
    );
    const late = await folded(source, pageOf([viewOf(adding, { view: 0 })]), runningClock(20_000));

    expect(page.views[0]?.stall).toMatchObject({ at: 0, kind: 'memory' });
    expect(late.views[0]).toMatchObject({ overtime: 0 });
  });

  it('stalls a view as raised when its fold runs deeper than the stack of the thread it runs on', async () => {
    const page = await folded(
      source,
      pageOf([viewOf('export function fold(view) {\n  return fold(view + 1);\n}', { view: 0 })], {
        stackBytes: workerStackBytes,
      }),
    );

    expect(page.views[0]?.stall).toMatchObject({
      at: 0,
      kind: 'raised',
      message: 'The program went deeper than the stack it runs on allows',
    });
  });
});

describe.each(sourcesUnderTest)('a view that stalls on what its fold answers on $name instances', ({ source }) => {
  it('stalls a view at the memory of its sandbox when the view the next fold is handed does not fit beside what the fold kept', async () => {
    const keeping = [
      'const kept = [];',
      'export function fold() {',
      '  const next = Array.from({ length: 80_000 }, () => []);',
      '  kept.push(next);',
      '  return next;',
      '}',
    ].join('\n');

    const page = await folded(source, pageOf([viewOf(keeping, { view: [] })], { memoryBytes: smallMemoryBytes }));

    expect(page.views[0]?.stall).toMatchObject({ at: 0, kind: 'memory' });
  });

  it('stalls when the view it answers is not what the view schema allows, keeping the view before', async () => {
    const schema = { type: 'object', maxProperties: 1 };

    const page = await folded(source, pageOf([viewOf(byCampaign, { schema })]));

    expect(page.views[0]).toMatchObject({
      folded: 1,
      lastFolded: 0,
      view: { spring: [{ verdict: 'approve' }] },
      stall: { at: 2, kind: 'schema', message: 'the view: Expected a value with at most 1 entry' },
    });
  });

  it('cuts the message of a stall at 1,024 bytes', async () => {
    const throwing = 'export function fold() {\n  throw new Error("x".repeat(5000));\n}';
    const page = await folded(source, pageOf([viewOf(throwing)]));

    expect(page.views[0]?.stall?.message).toBe(`Error: ${'x'.repeat(1017)}…`);
  });

  it('marks the event whose fold ran past its deadline, so it can be tried again, and folds nothing more', async () => {
    const slow = 'export function fold(view) {\n  for (;;) {}\n}';
    const page = await folded(
      source,
      pageOf([viewOf(slow, { view: 0 }), viewOf(adding, { view: 0 })], { foldDeadlineMs: 10, pageBudgetMs: 1_000_000 }),
      slowFirstFold(20),
    );

    expect(page.views[0]).toMatchObject({ view: 0, folded: 0, overtime: 0 });
    expect(page.views[0]).not.toHaveProperty('stall');
    expect(page.views[1]).toMatchObject({ view: 3, folded: 3 });
  });
});
