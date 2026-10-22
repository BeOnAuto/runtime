import type { CheckJob } from '@on.auto/workflow-engine/worker';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptLibOnDisk } from '../testing/read-on-disk.ts';
import { checkerOf } from './checking.ts';
import { sandboxLibFrom } from './kept-lib.ts';
import { answersAtOnce, holdsNothing, readsNothing, signatures } from './module-rules.ts';

const check = checkerOf(sandboxLibFrom(keptLibOnDisk));

const input: Schema.JsonObject = {
  type: 'object',
  required: ['period'],
  properties: { period: { type: 'object', required: ['days'], properties: { days: { type: 'integer' } } } },
};

const output: Schema.JsonObject = {
  type: 'object',
  required: ['total'],
  properties: { total: { type: 'number' }, note: { type: 'string' } },
};

function computation(source: string): CheckJob {
  return { module: { place: 'computation', source }, schemas: { input, output }, expressions: [] };
}

function issuesOf(source: string): readonly (readonly [number, string])[] {
  const answer = check(computation(source));
  return answer.ran === 'checked' ? answer.issues.map(({ line, detail }) => [line, detail] as const) : [];
}

function program(...body: readonly string[]): string {
  return ['export default function (input: Input): Output {', ...body, '}'].join('\n');
}

describe('a computation function checked when it is saved', () => {
  it('accepts a module whose default export answers the output from the input, and answers it stripped of its types', () => {
    expect(check(computation(program('  return { total: input.period.days * 2 };')))).toEqual({
      ran: 'checked',
      issues: [],
      stripped: {
        module: 'export default function (input       )         {\n  return { total: input.period.days * 2 };\n}',
        expressions: [],
      },
    });
  });

  it('refuses a misspelt field and an extra one with the compiler’s words at their lines', () => {
    expect(issuesOf(program('  const days = input.perod.days;', '  return { total: days, extra: 1 };'))).toEqual([
      [2, "Property 'perod' does not exist on type 'Input'. Did you mean 'period'?"],
      [3, "Object literal may only specify known properties, and 'extra' does not exist in type 'Output'."],
    ]);
  });

  it('refuses an optional member written undefined, as the repository’s own settings do', () => {
    expect(issuesOf(program('  return { total: 1, note: undefined };'))).toEqual([
      [
        2,
        "Type '{ total: number; note: undefined; }' is not assignable to type 'Output' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties. Types of property 'note' are incompatible. Type 'undefined' is not assignable to type 'string'.",
      ],
    ]);
  });

  it('refuses a syntax error at its line', () => {
    expect(issuesOf(program('  return { total: };'))).toEqual([[2, 'Expression expected.']]);
  });
});

describe('what a computation function’s module may hold', () => {
  it('refuses syntax that is not erasable', () => {
    expect(issuesOf(`enum Color { Red }\n${program('  return { total: 1 };')}`)).toEqual([
      [1, "This syntax is not allowed when 'erasableSyntaxOnly' is enabled."],
      [1, holdsNothing],
    ]);
  });

  it('refuses what reads outside its arguments or builds code, at its line', () => {
    expect(
      issuesOf(
        [
          "import { readFileSync } from 'node:fs';",
          'declare global {',
          '  var leaked: number;',
          '}',
          "import helper = require('./helper.ts');",
          "export * from './other.ts';",
          'export { twice };',
          program(
            '  const built = eval("1") + new Function("return 1")() + new Date().getTime();',
            "  const loaded = require('node:fs') + import('node:fs') + import.meta.url;",
            '  return { total: built + loaded };',
          ),
        ].join('\n'),
      ).filter(([, detail]) => [readsNothing, holdsNothing].includes(detail)),
    ).toEqual([
      [1, readsNothing],
      [2, readsNothing],
      [5, readsNothing],
      [6, readsNothing],
      [7, holdsNothing],
      [9, readsNothing],
      [9, readsNothing],
      [10, readsNothing],
      [10, readsNothing],
      [10, readsNothing],
    ]);
  });
});

describe('what a computation function’s module may keep', () => {
  it('refuses what a module would keep between two calls, and allows types, exported functions and overloads', () => {
    expect(
      issuesOf(
        [
          'type Total = Output["total"];',
          'interface Days { days: number }',
          'let calls = 0;',
          'function helper(): Total {',
          '  return 1;',
          '}',
          'export function twice(days: Days): number;',
          'export function twice(days: Days): number {',
          '  return days.days * 2;',
          '}',
          program('  return { total: twice(input.period) + helper() + calls };'),
        ].join('\n'),
      ),
    ).toEqual([
      [3, holdsNothing],
      [4, holdsNothing],
    ]);
  });
});

describe('the signature of a computation function', () => {
  it('refuses a program without a default export of the place’s signature', () => {
    expect(issuesOf('export function compute(input: Input): Output {\n  return { total: 1 };\n}')).toEqual([
      [1, signatures.default],
    ]);
    expect(
      issuesOf('export default function (input: Input, more: number): Output {\n  return { total: more };\n}'),
    ).toEqual([
      [
        1,
        `${signatures.default}: Type '(input: Input, more: number) => Output' is not assignable to type '(input: Input) => Output'. Target signature provides too few arguments. Expected 2 or more, but got 1.`,
      ],
    ]);
    expect(issuesOf('export function (input: Input): Output {\n  return { total: 1 };\n}')).toEqual([
      [1, 'Identifier expected.'],
      [1, signatures.default],
    ]);
  });

  it('refuses a default export whose types are not the input and output of the document', () => {
    expect(issuesOf('export default function (input: Input): string {\n  return "x";\n}')).toEqual([
      [
        1,
        `${signatures.default}: Type '(input: Input) => string' is not assignable to type '(input: Input) => Output'. Type 'string' is not assignable to type 'Output'.`,
      ],
    ]);
  });

  it('refuses a program that awaits or yields', () => {
    expect(
      issuesOf('export default async function (input: Input): Promise<Output> {\n  return { total: await 1 };\n}'),
    ).toEqual([
      [1, answersAtOnce],
      [2, answersAtOnce],
      [
        1,
        `${signatures.default}: Type '(input: Input) => Promise<Output>' is not assignable to type '(input: Input) => Output'. Property 'total' is missing in type 'Promise<Output>' but required in type 'Output'.`,
      ],
    ]);
    expect(issuesOf('export default function* (input: Input): Generator<Output> {\n  yield { total: 1 };\n}')).toEqual([
      [1, answersAtOnce],
      [
        1,
        `${signatures.default}: Type '(input: Input) => Generator<Output, any, any>' is not assignable to type '(input: Input) => Output'. Property 'total' is missing in type 'Generator<Output, any, any>' but required in type 'Output'.`,
      ],
    ]);
  });
});

describe('the names a program meets', () => {
  it('refuses what the sandbox lacks with the compiler’s words, since the check reads the sandbox’s own lib', () => {
    expect(
      issuesOf(
        program(
          '  fetch("https://example.com");',
          '  setTimeout(() => 1, 1);',
          '  console.log(process.env);',
          '  const random = Math.random();',
          '  const local = new Date(2026, 0, 1).getHours();',
          '  const zone = Intl.DateTimeFormat;',
          '  const kept = new WeakRef({});',
          '  return { total: random + local + Date().length };',
          '  Promise.resolve(1).then(() => kept);',
        ),
      ),
    ).toEqual([
      [2, "Cannot find name 'fetch'."],
      [3, "Cannot find name 'setTimeout'."],
      [4, "Cannot find name 'console'."],
      [4, "Cannot find name 'process'."],
      [5, "Property 'random' does not exist on type 'Math'."],
      [6, 'Expected 0-1 arguments, but got 3.'],
      [6, "Property 'getHours' does not exist on type 'Date'."],
      [7, "Cannot use namespace 'Intl' as a value."],
      [8, "Cannot find name 'WeakRef'."],
      [9, "Value of type 'DateConstructor' is not callable. Did you mean to include 'new'?"],
      [10, "'Promise' only refers to a type, but is being used as a value here."],
    ]);
  });

  it('accepts what the sandbox has: the library of the engine, the iterator helpers and dates in UTC', () => {
    expect(
      issuesOf(
        program(
          '  const at = new Date("2026-01-01T00:00:00Z").toISOString() + Date.UTC(2026, 0, 1) + Date.now();',
          '  const sorted = [3, 1].toSorted().at(-1) ?? 0;',
          '  const grouped = Object.groupBy([1, 2], (each) => String(each % 2));',
          '  const iterated = [1].values().map((each) => each + 1).toArray();',
          '  const joined = new Set([1]).union(new Set([2])).size;',
          '  return { total: at.length + sorted + Object.keys(grouped).length + iterated.length + joined };',
        ),
      ),
    ).toEqual([]);
  });
});
