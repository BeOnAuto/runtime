import { describe, expect, it } from 'vitest';

import { cappedOptions } from './outcome.ts';

describe('the options a refusal offers', () => {
  it('keep the question and every choice, each choice with at most one hundred issues of a detail and a pointer', () => {
    const issues = Array.from({ length: 150 }, (_unused, index) => ({
      detail: 'Write it',
      pointer: `/lines/${index}`,
      line: index,
    }));

    expect(cappedOptions({ question: 'Which way?', choices: [{ value: 'one', title: 'One', issues }] })).toEqual({
      question: 'Which way?',
      choices: [
        {
          value: 'one',
          title: 'One',
          issues: Array.from({ length: 100 }, (_unused, index) => ({ detail: 'Write it', pointer: `/lines/${index}` })),
        },
      ],
    });
  });
});
