import { describe, expect, it } from 'vitest';

import { colorDepthOf, linkerFor, painterFor } from './terminal.ts';

describe('the colors a stream shows', () => {
  it('are none when it is not a terminal', () => {
    expect(colorDepthOf({ isTTY: false, getColorDepth: () => 24 })).toBe(1);
    expect(colorDepthOf({})).toBe(1);
  });

  it('are none for a terminal that cannot say', () => {
    expect(colorDepthOf({ isTTY: true })).toBe(1);
  });

  it.each([
    [24, 24],
    [8, 8],
    [4, 4],
    [1, 1],
  ])('are a depth of %i bits for a terminal of %i bits', (reported, depth) => {
    expect(colorDepthOf({ isTTY: true, getColorDepth: () => reported })).toBe(depth);
  });
});

describe('painting text for a terminal', () => {
  it('leaves the text as it is where there are no colors', () => {
    expect(painterFor(1)('red', 'stopped')).toBe('stopped');
    expect(linkerFor(1)('http://localhost:5555/', 'the server')).toBe('the server');
  });

  it('styles the text and links the address where there are colors', () => {
    expect(painterFor(24)('red', 'stopped')).toBe('\u001B[31mstopped\u001B[39m');
    expect(linkerFor(8)('http://localhost:5555/', 'the server')).toBe(
      '\u001B]8;;http://localhost:5555/\u001B\\the server\u001B]8;;\u001B\\',
    );
  });
});
