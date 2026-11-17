import { mostInputBytes } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { definitionArgumentsOf } from './definition-arguments.ts';

describe('the input a workflow gives run_definition', () => {
  it('may take as much as a run takes as its input, 1 MiB as JSON, and one byte more is refused', () => {
    const text = 'x'.repeat(mostInputBytes - JSON.stringify({ text: '' }).length);

    expect([
      definitionArgumentsOf({ type: 'reasoning', name: 'summarize', input: { text } }),
      definitionArgumentsOf({ type: 'reasoning', name: 'summarize', input: { text: `${text}x` } }),
    ]).toEqual([
      { type: 'reasoning', name: 'summarize', input: { text } },
      {
        kind: 'validation',
        title:
          'The input of run_definition takes 1048577 bytes as JSON, more than the 1 MiB a run takes; give a smaller input, or split the work across several runs',
      },
    ]);
  });
});
