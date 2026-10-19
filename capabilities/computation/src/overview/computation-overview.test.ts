import { readFileSync } from 'node:fs';

import { markdownOf } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { computationWith } from '../testing/computation-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

const golden = readFileSync(new URL('reference-example.overview.md', import.meta.url), 'utf8');

const [, example = ''] = /```markdown\n([\s\S]*?)```/u.exec(page) ?? [];

const shapesPage = readFileSync(new URL('../../../../docs/reference/output-shapes.md', import.meta.url), 'utf8');

const [, shapedExample = ''] = [...shapesPage.matchAll(/```markdown\n([\s\S]*?)```/gu)][1] ?? [];

describe('the overview of the example of the reference of computation functions', () => {
  it('is, byte for byte, the overview pinned beside this test', () => {
    expect(markdownOf(computationWith().prepared(example).overview('campaign-pace'))).toBe(golden);
  });
});

describe('the overview of the computation function of the reference of output shapes', () => {
  it('is, byte for byte, the overview pinned beside this test', () => {
    expect(markdownOf(computationWith().prepared(shapedExample).overview('monthly-sign-ups'))).toBe(
      readFileSync(new URL('shaped-example.overview.md', import.meta.url), 'utf8'),
    );
  });
});

describe('the overview of a computation function', () => {
  it('says what a function without schemas takes and gives, and leaves its program to its source', () => {
    const source = [
      '---',
      'language: typescript',
      '---',
      'export default function (input: Input): Output {',
      '  return input;',
      '}',
    ];

    expect(markdownOf(computationWith().prepared(source.join('\n')).overview('echo'))).toBe(
      [
        '# echo',
        'This computation function has no description yet.',
        '## What it needs',
        'It takes any input, which its document does not describe.',
        '## What it produces',
        'It produces any output, which its document does not describe.',
        '## How it computes',
        'The program is TypeScript and is shown under Source.\n',
      ].join('\n\n'),
    );
  });
});
