import { Buffer } from 'node:buffer';

import type { DocumentGiven, DocumentText } from './document-text.ts';
import { textOfDocument } from './text-of-document.ts';

const continuationMask = 0xc0;

const continuationByte = 0x80;

const counts = new Intl.NumberFormat('en');

function cutNote(kept: number, bytes: number): string {
  return `\n[The text was cut to ${counts.format(kept)} of its ${counts.format(bytes)} bytes, the most the runtime answers of a document here.]`;
}

function atCodePoint(encoded: Readonly<Buffer>, mostBytes: number): string {
  let end = Math.max(0, mostBytes);
  while (end > 0 && (encoded.readUInt8(end) & continuationMask) === continuationByte) {
    end -= 1;
  }
  return encoded.subarray(0, end).toString('utf8');
}

function cutTo(text: string, mostBytes: number): string {
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.length <= mostBytes) {
    return text;
  }
  const kept = atCodePoint(encoded, mostBytes - Buffer.byteLength(cutNote(mostBytes, encoded.length)));
  return `${kept}${cutNote(Buffer.byteLength(kept), encoded.length)}`;
}

export async function textWithin(given: DocumentGiven, mostBytes: number): Promise<DocumentText> {
  const document = await textOfDocument(given);
  return document.read ? { ...document, text: cutTo(document.text, mostBytes) } : document;
}
