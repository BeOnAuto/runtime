import { describe, expect, it } from 'vitest';

import type { InstanceSource } from '../instances/instance-source.ts';
import { sourcesUnderTest, type SourceUnderTest } from '../pool-testing/test-pools.ts';
import { expressionUnitOf, type ExpressionUnit } from './expression-units.ts';
import { foldingUnitOf, type FilterContext, type Fold, type FoldingUnit } from './kept-contexts.ts';
import { moduleRun, type ModuleRun } from './module-runs.ts';
import type { Evaluation, ProgramRun } from './program-run.ts';
import { threadStackBytes, unitMemoryBytes } from './sandbox-bounds.ts';
import { sandboxRemovals } from './sandbox-names.ts';

const moment = Date.UTC(2026, 3, 1, 9, 30);

const evaluation: Evaluation = { budget: 500, deadlineAt: Number.POSITIVE_INFINITY, moment };

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: 1_048_576, clock: () => 0 };

const prepared: readonly (SourceUnderTest & { readonly unit: ExpressionUnit })[] = await Promise.all(
  sourcesUnderTest.map(async ({ name, source }) => {
    const instance = await source(unitMemoryBytes);
    return { name, source, unit: expressionUnitOf(() => instance, settings) };
  }),
);

function valueOf(unit: ExpressionUnit, expression: string): ProgramRun {
  return unit.evaluate(expression, {}, evaluation);
}

function attempted(unit: ExpressionUnit, source: string): unknown {
  const run = valueOf(
    unit,
    `(() => { try { const value = (${source}); return value instanceof Date ? 'Date ' + value.toISOString() : value } catch (error) { return 'threw ' + String(error) } })()`,
  );
  if (run.ran !== 'answered') {
    return run.issue.detail;
  }
  const answered: unknown = JSON.parse(run.text);
  return answered;
}

function nestedBody(levels: number): string {
  return `let value = 0;\n  for (let level = 0; level < ${levels}; level++) value = [value];\n  return value;`;
}

function foldOf(folding: FoldingUnit): FilterContext & { readonly fold: Fold } {
  if ('refused' in folding) {
    throw new Error(folding.refused.issue.detail);
  }
  return folding;
}

async function returned(source: InstanceSource, body: string): Promise<ModuleRun> {
  return moduleRun(await source(unitMemoryBytes), settings, {
    source: `export default function () {\n  ${body}\n}`,
    entry: 'default',
    arguments: [],
    evaluation,
  });
}

describe.each(prepared)('the Date of the sandbox on $name instances', ({ unit }) => {
  it('answers the moment of the run for now and for a Date made from nothing', () => {
    expect(attempted(unit, 'Date.now()')).toBe(moment);
    expect(attempted(unit, 'new Date()')).toBe('Date 2026-04-01T09:30:00.000Z');
    expect(attempted(unit, '(() => { class Stamp extends Date {} return new Stamp() })()')).toBe(
      'Date 2026-04-01T09:30:00.000Z',
    );
  });
});

describe.each(prepared)('a Date made in the sandbox on $name instances', ({ unit }) => {
  it('is made from one number, one Date, a date alone or a date and time that names its offset', () => {
    expect(attempted(unit, 'new Date(0)')).toBe('Date 1970-01-01T00:00:00.000Z');
    expect(attempted(unit, 'new Date(new Date(5))')).toBe('Date 1970-01-01T00:00:00.005Z');
    expect(attempted(unit, 'new Date("2026-01-01")')).toBe('Date 2026-01-01T00:00:00.000Z');
    expect(attempted(unit, 'new Date("2026-01-01T09:00:00+05:00")')).toBe('Date 2026-01-01T04:00:00.000Z');
    expect(attempted(unit, 'Date.parse("2026-01-01T09:00:00Z")')).toBe(Date.UTC(2026, 0, 1, 9));
    expect(attempted(unit, 'Date.UTC(2026, 0, 1)')).toBe(Date.UTC(2026, 0, 1));
  });
});

describe.each(prepared)('what the Date of the sandbox refuses on $name instances', ({ unit }) => {
  it('refuses whatever would read the time zone of the server', () => {
    const local =
      'threw TypeError: A Date made from several numbers reads the time zone of the server; make it from Date.UTC(...) instead';
    const text =
      'threw TypeError: A date is read from text only as a date alone or a date and time with its offset, such as 2026-01-01 or 2026-01-01T09:00:00Z';
    const written = 'threw TypeError: A Date is written as text with toISOString, which reads no time zone';

    expect(
      [
        'new Date(2026, 0, 1)',
        'new Date("2026-01-01T09:00:00")',
        'new Date("Jan 1 2026")',
        'Date.parse("2026-01-01 09:00")',
        'String(new Date(0))',
        '`${new Date(0)}`',
        'new Date(0) + ""',
        'new Date(0).toString()',
        'new Date(0).toLocaleString()',
        'new Date({})',
      ].map((expression) => attempted(unit, expression)),
    ).toEqual([
      local,
      text,
      text,
      text,
      written,
      written,
      written,
      written,
      written,
      'threw TypeError: A Date is made from no argument, one number, one string or one Date',
    ]);
    expect(attempted(unit, 'new Date(5) - new Date(2)')).toBe(3);
  });

  it('has no method that reads local time, and keeps those that read UTC', () => {
    expect(
      sandboxRemovals.dateMethods.map((name) =>
        attempted(unit, `typeof Reflect.get(new Date(0), ${JSON.stringify(name)})`),
      ),
    ).toEqual(sandboxRemovals.dateMethods.map(() => 'undefined'));
    expect(
      attempted(
        unit,
        '[new Date(0).getUTCHours(), new Date(0).toISOString(), new Date(0).toUTCString(), new Date(7).valueOf(), new Date(0).toJSON()].join(" | ")',
      ),
    ).toBe('0 | 1970-01-01T00:00:00.000Z | Thu, 01 Jan 1970 00:00:00 GMT | 7 | 1970-01-01T00:00:00.000Z');
  });
});

describe.each(prepared)('the original constructor of Date on $name instances', ({ unit }) => {
  it('is out of reach', () => {
    expect(
      [
        'Date()',
        'Reflect.construct(Date, [2026, 0, 1])',
        'new (Date.bind(null, 2026))(0, 1)',
        '(() => { class Local extends Date { constructor() { super(2026, 0, 1) } } return new Local() })()',
        'new (Object.getPrototypeOf(new Date()).constructor)(2026, 0, 1)',
      ].map((expression) => attempted(unit, expression)),
    ).toEqual([
      'threw TypeError: Date is called with new, as a constructor',
      ...Array.from(
        { length: 4 },
        () =>
          'threw TypeError: A Date made from several numbers reads the time zone of the server; make it from Date.UTC(...) instead',
      ),
    ]);
    expect(attempted(unit, 'Object.getPrototypeOf(new Date()).constructor === Date')).toBe(true);
  });
});

describe.each(prepared)('the names the sandbox removes on $name instances', ({ unit }) => {
  it('are absent, and so is every constructor of functions from text', () => {
    const absent = [...sandboxRemovals.globals, 'Intl', 'console', 'fetch', 'setTimeout'];

    expect(absent).toContain('Promise');
    expect(absent.map((name) => attempted(unit, `typeof ${name}`))).toEqual(absent.map(() => 'undefined'));
    expect(attempted(unit, 'typeof Math.random')).toBe('undefined');
    expect(
      [
        '(function () {}).constructor === Object',
        '(function* () {}).constructor === Object',
        'Object.getPrototypeOf(async function () {}).constructor === Object',
        'Object.getPrototypeOf(async function* () {}).constructor === Object',
      ].map((expression) => attempted(unit, expression)),
    ).toEqual([true, true, true, true]);
  });
});

const refusedAnswers: readonly (readonly [string, string, string])[] = [
  ['a Date', 'return { at: new Date(0) };', 'a Date at $.at'],
  ['a Map', 'return { kept: new Map([[1, 2]]) };', 'a Map at $.kept'],
  ['a Set', 'return { list: [1, new Set([1])] };', 'a Set at $.list[1]'],
  ['a class instance', 'class Point { x = 1 }\n  return { point: new Point() };', 'a Point at $.point'],
  ['a boxed string', 'return { text: new String("x") };', 'a String at $.text'],
  ['a typed array', 'return { bytes: new Uint8Array(2) };', 'a Uint8Array at $.bytes'],
  ['a function', 'return { run() { return 1; } };', 'a function at $.run'],
  ['a BigInt', 'return { count: 10n };', 'a bigint at $.count'],
  ['a symbol', 'return { tag: Symbol("x") };', 'a symbol at $.tag'],
  ['NaN', 'return { values: [0 / 0] };', 'NaN at $.values[0]'],
  ['Infinity', 'return { "odd key": 1 / 0 };', 'Infinity at $["odd key"]'],
  ['undefined', 'return { missing: undefined };', 'undefined at $.missing'],
  ['an empty place', 'return [1, , 3];', 'an empty place in a list at $[1]'],
  [
    'a cycle',
    'const looped = { inner: {} };\n  Reflect.set(Object(looped.inner), "back", looped);\n  return looped;',
    'a cycle at $.inner.back',
  ],
  [
    'an object of no named class',
    'return { made: Object.create(Object.create(null)) };',
    'an object of a class at $.made',
  ],
  ['a member that writes itself with toJSON', 'return { at: { toJSON: () => 1 } };', 'a function at $.at.toJSON'],
  [
    'a member that changes as it is read',
    'return { get fresh() { return {}; } };',
    'a member that changes as it is read',
  ],
];

describe.each(prepared)('the answer of a program on $name instances', ({ source, unit }) => {
  it('is read as JSON in the order its keys were written', async () => {
    expect(await returned(source, 'return { b: 1, a: [1, "x", true, null, { c: -0 }] };')).toMatchObject({
      ran: 'answered',
      text: '{"b":1,"a":[1,"x",true,null,{"c":0}]}',
    });
  });

  it.each(refusedAnswers)('refuses %s, naming where it is', async (_what, body, where) => {
    expect(await returned(source, body)).toMatchObject({
      ran: 'unfit',
      issue: { detail: `The answer holds ${where}, which JSON cannot carry` },
    });
  });

  it('refuses undefined at its top, which an expression answers as null', async () => {
    expect(await returned(source, 'return undefined;')).toMatchObject({
      ran: 'unfit',
      issue: { detail: 'The answer holds undefined at $, which JSON cannot carry' },
    });
    expect(valueOf(unit, '({ id: 1, note: undefined })')).toMatchObject({
      ran: 'answered',
      text: '{"id":1,"note":null}',
    });
    expect(valueOf(unit, 'undefined')).toMatchObject({ ran: 'answered', text: 'null' });
  });
});

describe.each(prepared)('the answer a program may give on $name instances', ({ source }) => {
  it('passes a value shared twice, which is no cycle, and a value of a null prototype', async () => {
    expect(
      await returned(
        source,
        'const shared = { x: 1 };\n  return { a: shared, b: shared, c: Object.assign(Object.create(null), { y: 2 }) };',
      ),
    ).toMatchObject({
      ran: 'answered',
      text: '{"a":{"x":1},"b":{"x":1},"c":{"y":2}}',
    });
  });

  it('refuses a value nested deeper than 512 levels, and passes one of 512', async () => {
    expect(await returned(source, nestedBody(512))).toMatchObject({ ran: 'answered' });
    expect(await returned(source, nestedBody(513))).toMatchObject({
      ran: 'unfit',
      issue: {
        detail: `The answer holds a value deeper than 512 levels at $${'[0]'.repeat(512)}, which JSON cannot carry`,
      },
    });
  });

  it('raises what a getter of the answer throws, as the program raised it', async () => {
    expect(await returned(source, 'return { get broken() { throw new RangeError("no") } };')).toMatchObject({
      ran: 'unfit',
      issue: { detail: 'RangeError: no' },
    });
  });
});

describe.each(prepared)('a context the sandbox freezes on $name instances', ({ source }) => {
  it('lets an Error of a program name itself and a value take a key its prototype has', async () => {
    const folding = foldOf(
      foldingUnitOf(
        await source(unitMemoryBytes),
        settings,
        {
          fold: [
            'class Refusal extends Error {',
            '  constructor(message) {',
            '    super(message);',
            '    this.name = "Refusal";',
            '  }',
            '}',
            'export function fold(view, event) {',
            '  const next = { ...view };',
            '  next[event.key] = true;',
            '  next["name"] = new Refusal("kept").name;',
            '  return next;',
            '}',
          ].join('\n'),
          view: '{}',
        },
        evaluation,
      ),
    );
    const frozen = folding.freeze();
    const run = folding.fold('{"key":"constructor"}', evaluation);
    folding.close();

    expect(frozen).toBeUndefined();
    expect(run).toMatchObject({ ran: 'answered', text: '{"constructor":true,"name":"Refusal"}' });
  });
});
