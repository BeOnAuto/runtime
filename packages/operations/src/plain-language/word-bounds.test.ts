import { describe, expect, it } from 'vitest';

import { mostOutcomeCharacters, mostRefusalCharacters, withinCharacters } from '../index.ts';

function sentenceOf(length: number): string {
  return `${'A'.padEnd(length - 1, 'a')}.`;
}

describe('the words of an outcome and of a refusal', () => {
  it('take at most 400 and 600 characters', () => {
    expect([mostOutcomeCharacters, mostRefusalCharacters]).toEqual([400, 600]);
  });
});

describe('words within a bound', () => {
  it('are kept whole at the bound', () => {
    const atTheBound = `${sentenceOf(199)} ${sentenceOf(200)}`;

    expect(withinCharacters(atTheBound, 400)).toBe(atTheBound);
  });

  it('keep the whole sentences that fit one character over it, and say the rest is in the details', () => {
    const first = sentenceOf(199);

    const bounded = withinCharacters(`${first} ${sentenceOf(201)}`, 400);

    expect(bounded).toBe(`${first} The rest is in the details below.`);
  });

  it('cut a first sentence longer than the bound at a word, with an ellipsis', () => {
    const bounded = withinCharacters(`${'word '.repeat(100)}end.`, 400);

    expect(bounded.length).toBeLessThanOrEqual(400);
    expect(bounded).toMatch(/^(?:word )+word… The rest is in the details below\.$/u);
  });

  it('cut a first word longer than the bound where it reaches the bound', () => {
    const bounded = withinCharacters(`${'x'.repeat(500)}.`, 400);

    expect(bounded).toBe(`${'x'.repeat(365)}… The rest is in the details below.`);
  });

  it('are kept whole when only the space between their sentences takes them over it', () => {
    expect(withinCharacters(`It ran.${' '.repeat(400)}It ended.`, 400)).toBe('It ran. It ended.');
  });
});
