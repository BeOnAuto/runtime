import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { boundedAnswerOf } from '../index.ts';

describe('an answer read within a bound of its bytes', () => {
  it('is read whole when it keeps to the bound, and says nothing', async () => {
    const passed: string[] = [];

    const answer = boundedAnswerOf(new Response('four'), 4, () => {
      passed.push('too large');
    });

    await expect(answer.text()).resolves.toBe('four');
    expect(passed).toEqual([]);
  });

  it('fails past the bound, saying so, and tells whoever reads it', async () => {
    const passed: string[] = [];

    const answer = boundedAnswerOf(new Response('fives'), 4, () => {
      passed.push('too large');
    });

    await expect(answer.text()).rejects.toThrow('The answer takes more than the 4 bytes it may take');
    expect(passed).toEqual(['too large']);
  });

  it('is the answer itself when it has no body, with its status', () => {
    const empty = new Response(null, { status: 204 });

    expect(boundedAnswerOf(empty, 4, Function.constVoid)).toBe(empty);
  });
});
