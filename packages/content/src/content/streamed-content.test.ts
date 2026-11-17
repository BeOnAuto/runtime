import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { contentOfBytes, contentOfText, textOfContent, textToKeep } from './streamed-content.ts';
import { textPieceCodeUnits } from './text-pieces.ts';

async function piecesOf(text: string): Promise<readonly Readonly<Uint8Array>[]> {
  const pieces: Readonly<Uint8Array>[] = [];
  for await (const piece of textToKeep(text, 'application/json').stream) {
    pieces.push(piece);
  }
  return pieces;
}

describe('a text to keep', () => {
  it('streams the UTF-8 of the text a piece at a time, never a piece of more than three bytes a code unit', async () => {
    const text = `${'x'.repeat(textPieceCodeUnits - 1)}\u{1D11E}é ✓`.repeat(4);

    const pieces = await piecesOf(text);

    expect({
      bytes: Buffer.concat(pieces).equals(Buffer.from(text, 'utf8')),
      several: pieces.length > 4,
      largest: Math.max(...pieces.map(({ byteLength }) => byteLength)) <= 3 * textPieceCodeUnits,
    }).toEqual({ bytes: true, several: true, largest: true });
  });

  it('streams nothing of no text', async () => {
    await expect(piecesOf('')).resolves.toEqual([]);
  });
});

describe('a content as a stream of bytes', () => {
  it('carries a text as its UTF-8 bytes, with their size and its media type, and reads back as that text', async () => {
    const content = contentOfText('é ✓ 𝄞', 'text/plain');

    expect({ bytes: content.bytes, mediaType: content.mediaType }).toEqual({ bytes: 11, mediaType: 'text/plain' });
    await expect(Effect.runPromise(textOfContent(content))).resolves.toBe('é ✓ 𝄞');
  });

  it('carries bytes as they are, and fails as a defect when they are read as text and are not UTF-8', async () => {
    const bytes = Uint8Array.of(0xff, 0xfe);
    const content = contentOfBytes(bytes, 'application/octet-stream');
    bytes.fill(0);

    expect(content.bytes).toBe(2);
    await expect(Effect.runPromise(textOfContent(content))).rejects.toThrow('The encoded data was not valid');
  });
});
