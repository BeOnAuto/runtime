import { describe, expect, it } from 'vitest';

import { textPieces } from './text-pieces.ts';

const clef = '\u{1D11E}';

describe('the pieces of a text', () => {
  it('are none for no text, and the text whole where it is shorter than a piece', () => {
    expect([[...textPieces('')], [...textPieces('abc', 4)]]).toEqual([[], ['abc']]);
  });

  it('cut a text every so many code units, and never between the two halves of a character', () => {
    expect([...textPieces(`ab${clef}cd`, 3)]).toEqual(['ab', `${clef}c`, 'd']);
  });

  it('keep a half of a character alone where the text has it alone, and both halves where a piece is one code unit', () => {
    expect([[...textPieces('\uD834a\uDD1E', 1)], [...textPieces(`a${clef}`, 1)]]).toEqual([
      ['\uD834', 'a', '\uDD1E'],
      ['a', clef],
    ]);
  });

  it('join back into the text they were cut from', () => {
    const text = `${'x'.repeat(5)}${clef}`.repeat(1000);

    expect([...textPieces(text, 7)].join('')).toBe(text);
  });
});
