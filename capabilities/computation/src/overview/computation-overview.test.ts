import { readFileSync } from 'node:fs';

import { markdownOf } from '@on.auto/definitions';
import { overviewAsRead } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { computationWith } from '../testing/computation-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

const golden = readFileSync(new URL('reference-example.overview.md', import.meta.url), 'utf8');

const [, example = ''] = /```markdown\n([\s\S]*?)```/u.exec(page) ?? [];

const shapesPage = readFileSync(new URL('../../../../docs/reference/output-shapes.md', import.meta.url), 'utf8');

const [, shapedExample = ''] = [...shapesPage.matchAll(/```markdown\n([\s\S]*?)```/gu)][1] ?? [];

const monthWindow = [
  '---',
  `description: 'Turns a month such as 2026-04 or "April 2026" into its date range, the previous month''s date range and readable labels'`,
  'language: typescript',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [month]',
  '    properties:',
  "      month: { type: string, minLength: 6, maxLength: 20, description: 'The month to report on, as 2026-04 or April 2026' }",
  'output:',
  '  schema:',
  '    type: object',
  '    required: [month, label, start, end, prev_label, prev_start, prev_end]',
  '    properties:',
  '      month: { type: string }',
  '      label: { type: string }',
  '      start: { type: string }',
  '      end: { type: string }',
  '      prev_label: { type: string }',
  '      prev_start: { type: string }',
  '      prev_end: { type: string }',
  '---',
  'export default function (input: Input): Output {',
  "  const [year = '', month = ''] = input.month.split('-');",
  "  const previous = month === '01' ? `${Number(year) - 1}-12` : `${year}-${String(Number(month) - 1).padStart(2, '0')}`;",
  '  return {',
  '    month: input.month,',
  '    label: input.month,',
  '    start: `${input.month}-01`,',
  '    end: `${input.month}-28`,',
  '    prev_label: previous,',
  '    prev_start: `${previous}-01`,',
  '    prev_end: `${previous}-28`,',
  '  };',
  '}',
].join('\n');

function overviewOf(source: string, name: string): string {
  return markdownOf(computationWith().prepared(source).overview(name));
}

describe('the overview of the example of the reference of computation functions', () => {
  it('is, byte for byte, the overview pinned beside this test', () => {
    expect(overviewOf(example, 'campaign-pace')).toBe(golden);
  });
});

describe('the overview of the computation function of the reference of output shapes', () => {
  it('is, byte for byte, the overview pinned beside this test, the shape it answers told in its sentence', () => {
    expect(overviewOf(shapedExample, 'monthly-sign-ups')).toBe(
      readFileSync(new URL('shaped-example.overview.md', import.meta.url), 'utf8'),
    );
  });
});

describe('the overview of a computation function a workflow calls', () => {
  it('tells what it is given and answers by the meanings of its fields, and is, as read, the overview pinned beside this test', () => {
    const overview = computationWith().prepared(monthWindow).overview('month-window');
    const caller = {
      type: 'workflow',
      name: 'monthly-website-report',
      details: {
        title: 'Monthly website report',
        calls: [{ type: 'computation', name: 'month-window', steps: [{ number: 1, name: 'work-out-month' }] }],
      },
    };

    expect(overviewAsRead({ type: 'computation', name: 'month-window', overview }, [caller])).toBe(
      readFileSync(new URL('month-window.overview.md', import.meta.url), 'utf8'),
    );
  });
});

describe('the overview of a computation function', () => {
  it('says that a function without schemas is given any input and answers any value, and holds the rest under Details', () => {
    const source = [
      '---',
      'language: typescript',
      '---',
      'export default function (input: Input): Output {',
      '  return input;',
      '}',
    ];

    expect(overviewOf(source.join('\n'), 'echo')).toBe(
      [
        '# echo',
        'This computation function has no description yet.',
        'It is given any input, and a program works out the answer, the same every time for the same input: any value.',
        '## Details',
        '### Input',
        'It takes any input, which its document does not describe.',
        '### Output',
        'It produces any output, which its document does not describe.',
        '### Program',
        "TypeScript, in the definition's document.\n",
      ].join('\n\n'),
    );
  });
});

describe('the overview of a computation function whose document has an about', () => {
  it('writes the about as its author wrote it, after the description and before what it is given', () => {
    const source = [
      '---',
      'description: Adds one',
      'about: |',
      '  The finance team reads it to see *how many* campaigns there are.',
      '',
      '  A workflow runs it at the end of each period.',
      'language: typescript',
      '---',
      'export default function (input: Input): Output {',
      '  return input;',
      '}',
    ];

    expect(overviewOf(source.join('\n'), 'count').split('\n\n').slice(0, 5)).toEqual([
      '# count',
      'Adds one.',
      'The finance team reads it to see *how many* campaigns there are.',
      'A workflow runs it at the end of each period.',
      'It is given any input, and a program works out the answer, the same every time for the same input: any value.',
    ]);
  });
});
