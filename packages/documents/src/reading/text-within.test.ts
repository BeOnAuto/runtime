import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { refusedUnlessOutOfMemory } from './document-text.ts';
import { textWithin } from './text-within.ts';

const encoded = new TextEncoder();

function noteOf(kept: number, bytes: number): string {
  return `\n[The text was cut to ${kept} of its ${bytes} bytes, the most the runtime answers of a document here.]`;
}

function textOf(text: string, mostBytes: number) {
  return textWithin({ bytes: encoded.encode(text), mediaType: 'text/plain', name: undefined }, mostBytes);
}

describe('the text of a document within the bytes it may take', () => {
  it('is whole where it fits, and else cut at a whole character with a last line saying so', async () => {
    const accented = 'é'.repeat(100);
    const room = 150 - Buffer.byteLength(noteOf(150, 200));

    const texts = await Promise.all([textOf('Net 30', 6), textOf('x'.repeat(200), 150), textOf(accented, 150)]);

    expect(texts).toEqual([
      { read: true, text: 'Net 30', mediaType: 'text/plain' },
      { read: true, text: `${'x'.repeat(room)}${noteOf(room, 200)}`, mediaType: 'text/plain' },
      {
        read: true,
        text: `${'é'.repeat(Math.floor(room / 2))}${noteOf(Math.floor(room / 2) * 2, 200)}`,
        mediaType: 'text/plain',
      },
    ]);
    expect(room % 2).toBe(1);
  });

  it('keeps nothing of a text where its last line takes all the room, and leaves a document not read as it is', async () => {
    const texts = await Promise.all([
      textOf('x'.repeat(200), 10),
      textWithin({ bytes: encoded.encode('png'), mediaType: 'image/png', name: undefined }, 10),
    ]);

    expect(texts).toEqual([
      { read: true, text: noteOf(0, 200), mediaType: 'text/plain' },
      {
        read: false,
        because: 'The runtime does not read image/png as text; it reads text, PDF and Word documents',
        mediaType: 'image/png',
      },
    ]);
  });
});

describe('a reader that meets an error', () => {
  it('refuses the document in words with the first line of the error, and lets an allocation that failed through', () => {
    expect(refusedUnlessOutOfMemory(new Error('Broken\nat line 2'), 'It is not a PDF the runtime can read')).toEqual({
      read: false,
      because: 'It is not a PDF the runtime can read: Error: Broken',
    });
    expect(() =>
      refusedUnlessOutOfMemory(
        new RangeError('Array buffer allocation failed'),
        'It is not a PDF the runtime can read',
      ),
    ).toThrow('Array buffer allocation failed');
  });
});
