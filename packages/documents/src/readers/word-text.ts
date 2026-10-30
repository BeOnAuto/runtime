import { Buffer } from 'node:buffer';

import { refusedUnlessOutOfMemory, textRead, type DocumentRead } from '../reading/document-text.ts';

function bufferHoldingOnly(bytes: Readonly<Uint8Array>): ArrayBuffer {
  const { buffer } = bytes;
  return buffer instanceof ArrayBuffer && buffer.byteLength === bytes.byteLength ? buffer : bytes.slice().buffer;
}

export async function wordTextOf(bytes: Readonly<Uint8Array>): Promise<DocumentRead> {
  const { default: mammoth } = await import('mammoth');
  const arrayBuffer = bufferHoldingOnly(bytes);
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer), arrayBuffer });
    return textRead(value.trimEnd());
  } catch (error) {
    return refusedUnlessOutOfMemory(error, 'It is not a Word document the runtime can read');
  }
}
