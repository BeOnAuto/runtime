import { documentBounds, documentTooLarge } from './document-bounds.ts';
import { notRead, type DocumentGiven, type DocumentText } from './document-text.ts';
import { documentTypeOf, readerOf } from './media-types.ts';

function notReadAsText(mediaType: string): string {
  return `The runtime does not read ${mediaType} as text; it reads text, PDF and Word documents`;
}

export async function textOfDocument({ bytes, mediaType, name }: DocumentGiven): Promise<DocumentText> {
  const type = documentTypeOf(mediaType, name);
  if (bytes.byteLength > documentBounds.bytes) {
    return { ...notRead(documentTooLarge), mediaType: type.mediaType };
  }
  const reader = readerOf(type.mediaType);
  const read = reader === undefined ? notRead(notReadAsText(type.mediaType)) : await reader(bytes, type);
  return { ...read, mediaType: type.mediaType };
}
