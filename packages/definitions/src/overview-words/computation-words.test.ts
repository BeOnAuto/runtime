import { describe, expect, it } from 'vitest';

import { markdownOf, type OverviewBlock, type OverviewSection } from '../index.ts';
import { shapeNamed } from '../testing/index.ts';
import { computedSentence, programSection } from './computation-words.ts';

function writtenOf(body: readonly OverviewBlock[], appendix: readonly OverviewSection[] = []): string {
  return markdownOf({ title: 'month-window', opening: ['Works out a month'], body, sections: [], appendix })
    .split('\n\n')
    .slice(2)
    .join('\n\n');
}

const month = {
  type: 'object',
  required: ['month'],
  properties: { month: { type: 'string', description: 'The month to report on, as 2026-04 or April 2026' } },
};

describe('the sentence of a computation function', () => {
  it('says what it is given and that a program works out the same answer for the same input, then what it answers', () => {
    expect([
      writtenOf([
        computedSentence({
          input: month,
          output: {
            type: 'object',
            required: ['start', 'end'],
            properties: { start: { type: 'string' }, end: { type: 'string' } },
          },
        }),
      ]),
      writtenOf([computedSentence({ input: month, shape: shapeNamed('series') })]),
      writtenOf([computedSentence({})]),
    ]).toEqual([
      'It is given the month to report on, as 2026-04 or April 2026, and a program works out the answer, the same every time for the same input: the start and the end.\n',
      'It is given the month to report on, as 2026-04 or April 2026, and a program works out the answer, the same every time for the same input: a series over time.\n',
      'It is given any input, and a program works out the answer, the same every time for the same input: any value.\n',
    ]);
  });
});

describe('the program of a computation function, under Details', () => {
  it('names its language and says that it is in the definition', () => {
    expect(writtenOf([], [programSection('typescript')])).toBe(
      "## Details\n\n### Program\n\nTypeScript, in the definition's document.\n",
    );
  });
});
