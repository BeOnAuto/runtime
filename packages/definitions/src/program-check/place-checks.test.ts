import type { CheckJob } from '@on.auto/workflow-engine/worker';
import { describe, expect, it } from 'vitest';

import { keptLibOnDisk } from '../testing/read-on-disk.ts';
import { checkerOf } from './checking.ts';
import { oneExpression } from './expression-issues.ts';
import { sandboxLibFrom } from './kept-lib.ts';
import { holdsNothing, readsNothing, signatures } from './module-rules.ts';

const check = checkerOf(sandboxLibFrom(keptLibOnDisk));

const fold = [
  'export function fold(view: View, event: Event): View {',
  "  return event.type === 'run_succeeded' ? view : { ...view };",
  '}',
].join('\n');

function page(source: string, filters: CheckJob['expressions'] = []): CheckJob {
  return { module: { place: 'page', source }, schemas: {}, expressions: filters };
}

function expressions(...checked: CheckJob['expressions']): CheckJob {
  return { schemas: {}, expressions: checked };
}

function issuesOf(job: CheckJob): readonly (readonly [number | 'module', number, string])[] {
  const answer = check(job);
  return answer.ran === 'checked' ? answer.issues.map(({ at, line, detail }) => [at, line, detail] as const) : [];
}

const overData = ['$data'];

describe('the fold of a page checked when it is saved', () => {
  it('accepts a module with its fold over the views and the event', () => {
    expect(issuesOf(page(fold, [{ source: ' $data.revenue > 100 ', names: overData }]))).toEqual([]);
  });

  it('refuses a module without its fold, and a misspelt attribute of the event', () => {
    expect(issuesOf(page('export function shown(view: View): View {\n  return view;\n}'))).toEqual([
      ['module', 1, signatures.fold],
    ]);
    expect(issuesOf(page(fold.replace('event.type ===', 'event.typ ===')))).toEqual([
      ['module', 2, "Property 'typ' does not exist on type 'Event'. Did you mean 'type'?"],
    ]);
  });

  it('refuses state kept between folds and names declared from outside', () => {
    expect(issuesOf(page(`let seen = 0;\ndeclare global {\n  var shared: number;\n}\n${fold}`))).toEqual([
      ['module', 1, holdsNothing],
      ['module', 2, readsNothing],
    ]);
  });

  it('refuses a filter that names anything but $data', () => {
    expect(issuesOf(page(fold, [{ source: ' $workflow.input.limit < $data.revenue ', names: overData }]))).toEqual([
      [0, 1, "Cannot find name '$workflow'."],
    ]);
  });
});

describe('expressions checked when a document is saved', () => {
  it('answers each expression a passing document holds stripped of its types, in their order', () => {
    expect(
      check(expressions({ source: '$data.n as number', names: overData }, { source: '$data.n + 1', names: overData })),
    ).toEqual({ ran: 'checked', issues: [], stripped: { expressions: ['$data.n          ', '$data.n + 1'] } });
  });

  it('checks every expression of a document as one file, naming each issue by its expression and its line', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      source: ` ({ ...$context, n: $data.n + ${index} }) `,
      names: ['$data', '$context'],
    })).with(57, { source: '[\n  $data,\n  $nope,\n]', names: ['$data', '$context'] });

    expect(issuesOf(expressions(...many))).toEqual([[57, 3, "Cannot find name '$nope'."]]);
  });

  it('refuses an expression that is not one expression, with the names it may read', () => {
    expect(
      issuesOf(
        expressions(
          { source: '$data +', names: overData },
          { source: '1; 2', names: ['$data', '$input'] },
          { source: '$data', names: overData },
        ),
      ),
    ).toEqual([
      [0, 1, `Expression expected; ${oneExpression(overData).replace('An', 'an')}`],
      [1, 1, `')' expected; ${oneExpression(['$data', '$input']).replace('An', 'an')}`],
      [1, 1, `Declaration or statement expected; ${oneExpression(['$data', '$input']).replace('An', 'an')}`],
    ]);
  });

  it('refuses an expression that closes its parentheses to write statements of its own', () => {
    const escapes = [
      '$data); fetch("x"); (1',
      '1); } const leak = 1; function z() { return (1',
      '1); } export function e() {} export function f() { return (1',
      '1); } export function g() { 1; } export function h() { return (1',
      '1); } export function q(): void; export function q() { return (1',
    ];

    expect(issuesOf(expressions(...escapes.map((source) => ({ source, names: overData }))))).toEqual(
      escapes.map((_, index) => [index, 1, oneExpression(overData)]),
    );
  });
});
