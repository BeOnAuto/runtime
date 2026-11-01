import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { contentOfBytes, contentOfText, textOfContent } from './streamed-content.ts';

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
