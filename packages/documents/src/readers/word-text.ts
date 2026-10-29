import { Buffer } from 'node:buffer';

import { refusedUnlessOutOfMemory, textRead, type DocumentRead } from '../reading/document-text.ts';

export async function wordTextOf(bytes: Readonly<Uint8Array>): Promise<DocumentRead> {
  const { default: mammoth } = await import('mammoth');
  try {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    });
    return textRead(value.trimEnd());
  } catch (error) {
    return refusedUnlessOutOfMemory(error, 'It is not a Word document the runtime can read');
  }
}
