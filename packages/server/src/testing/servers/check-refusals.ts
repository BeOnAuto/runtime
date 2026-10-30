export type CheckRefusal = readonly [string, readonly string[], readonly string[]];

const input = 'input:\n  schema: {type: object, required: [period], properties: {period: {type: integer}}}';

const output = 'output:\n  schema: {type: object, required: [total], properties: {total: {type: number}}}';

const readsNothing = 'A program reads nothing but its arguments: it imports no module and builds no code';

const holdsNothing =
  'A module holds its types and its exported functions and nothing else, so that two calls share nothing';

const answersAtOnce = 'The program is a function that answers at once; it awaits nothing';

export function documentOf(program: readonly string[], language = 'typescript'): string {
  return ['---', `language: ${language}`, input, output, '---', ...program].join('\n');
}

export function totalOf(...body: readonly string[]): readonly string[] {
  return ['export default function (input: Input): Output {', ...body, '}'];
}

export const checkRefusals: readonly CheckRefusal[] = [
  ['a syntax error', totalOf('  return { total: };'), ['Line 9: Expression expected.']],
  [
    'a misspelt field',
    totalOf('  return { total: input.perod };'),
    ["Line 9: Property 'perod' does not exist on type 'Input'. Did you mean 'period'?"],
  ],
  [
    'syntax that is not erasable',
    ['enum Color { Red }', ...totalOf('  return { total: 1 };')],
    ["Line 8: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.", `Line 8: ${holdsNothing}`],
  ],
  [
    'an import',
    ["import { readFileSync } from 'node:fs';", ...totalOf('  return { total: readFileSync.length };')],
    ["Line 8: Cannot find name 'node:fs'.", `Line 8: ${readsNothing}`],
  ],
  [
    'require',
    totalOf("  const fs = require('node:fs');", '  return { total: fs.length };'),
    ["Line 9: Cannot find name 'require'.", `Line 9: ${readsNothing}`],
  ],
  [
    'eval',
    totalOf("  return { total: eval('1 + 1') };"),
    ["Line 9: Cannot find name 'eval'.", `Line 9: ${readsNothing}`],
  ],
  [
    'new Function',
    totalOf("  const make = new Function('return 1');", '  return { total: make() };'),
    ["Line 9: 'Function' only refers to a type, but is being used as a value here.", `Line 9: ${readsNothing}`],
  ],
  [
    'a dynamic import',
    totalOf("  const loaded = import('node:fs');", '  return { total: loaded ? 1 : 0 };'),
    [
      "Line 8: Cannot find global value 'Promise'.",
      "Line 9: A dynamic import call in ES5 requires the 'Promise' constructor. Make sure you have a declaration for the 'Promise' constructor or include 'ES2015' in your '--lib' option.",
      "Line 9: Cannot find name 'node:fs'.",
      `Line 9: ${readsNothing}`,
      "Line 10: This condition will always return true since this 'Promise<any>' is always defined.",
    ],
  ],
  [
    'import.meta',
    totalOf('  return { total: import.meta.url.length };'),
    ["Line 9: Property 'url' does not exist on type 'ImportMeta'.", `Line 9: ${readsNothing}`],
  ],
  [
    'declare global',
    ['declare global {', '  var kept: number;', '}', ...totalOf('  return { total: kept };')],
    [`Line 8: ${readsNothing}`],
  ],
  [
    'state kept between two runs',
    ['let runs = 0;', ...totalOf('  return { total: runs };')],
    [`Line 8: ${holdsNothing}`],
  ],
  [
    'no default export',
    ['export function total(input: Input): Output {', '  return { total: input.period };', '}'],
    ['Line 8: The program is a module whose default export is a function (input: Input): Output'],
  ],
  [
    'a program that awaits',
    ['export default async function (input: Input): Promise<Output> {', '  return { total: await input.period };', '}'],
    [
      `Line 8: ${answersAtOnce}`,
      "Line 8: The program is a module whose default export is a function (input: Input): Output: Type '(input: Input) => Promise<Output>' is not assignable to type '(input: Input) => Output'. Property 'total' is missing in type 'Promise<Output>' but required in type 'Output'.",
      `Line 9: ${answersAtOnce}`,
    ],
  ],
  [
    'an exported generator',
    ['export default function* (input: Input) {', '  yield { total: input.period };', '}'],
    [
      `Line 8: ${answersAtOnce}`,
      "Line 8: The program is a module whose default export is a function (input: Input): Output: Type '(input: Input) => Generator<{ total: number; }, void, unknown>' is not assignable to type '(input: Input) => Output'. Property 'total' is missing in type 'Generator<{ total: number; }, void, unknown>' but required in type 'Output'.",
    ],
  ],
  [
    'more than 500 assignments in one function',
    totalOf('  let n = 0;', ...Array.from({ length: 501 }, () => '  n += 1;'), '  return { total: n };'),
    [
      "Line 510: A function may assign to its variables at most 500 times, since the compiler's analysis of each assignment grows with the others; keep the values in a list, an object or a loop",
    ],
  ],
  [
    'a name the sandbox lacks',
    totalOf('  return { total: Math.random() };'),
    ["Line 9: Property 'random' does not exist on type 'Math'."],
  ],
];
