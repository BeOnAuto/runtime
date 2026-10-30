import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { logoHeight, logoLines, logoWidth } from './logo.ts';

describe('the logo', () => {
  it('is drawn in rows of half blocks, two pixels to a character', () => {
    const lines = logoLines(24);

    expect(lines).toHaveLength(logoHeight);
    for (const line of lines) {
      expect(stripVTControlCharacters(line)).toHaveLength(logoWidth);
    }
  });

  it('paints the tile, the shapes on it and the four stripes in their colors', () => {
    const drawn = logoLines(24).join('');

    for (const color of ['255;255;255', '26;26;26', '236;63;74', '255;138;29', '94;199;45', '66;195;247']) {
      expect(drawn).toContain(color);
    }
  });

  it('draws a pixel above another of the same color as a full block, and one of another color as two halves', () => {
    const drawn = logoLines(24).join('');

    expect(drawn).toContain('\u001B[38;2;255;255;255m█\u001B[0m');
    expect(drawn).toContain('\u001B[38;2;255;255;255;48;2;26;26;26m▀\u001B[0m');
  });

  it('draws a pixel with nothing below it as an upper half, and one with nothing above it as a lower half', () => {
    const drawn = logoLines(24).join('');

    expect(drawn).toContain('\u001B[38;2;236;63;74m▀\u001B[0m');
    expect(drawn).toContain('\u001B[38;2;236;63;74m▄\u001B[0m');
  });

  it('uses the 256 colors of a terminal without true color, and the 16 of a basic one', () => {
    expect(logoLines(8).join('')).toContain('\u001B[38;5;231;48;5;234m▀');
    expect(logoLines(4).join('')).toContain('\u001B[97;40m▀');
  });
});
