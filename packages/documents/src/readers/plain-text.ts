import { textRead, viewOf, type DocumentRead, type DocumentType } from '../reading/document-text.ts';

const byteOrderMarks: readonly (readonly [readonly number[], string])[] = [
  [[0xef, 0xbb, 0xbf], 'utf-8'],
  [[0xff, 0xfe], 'utf-16le'],
  [[0xfe, 0xff], 'utf-16be'],
];

function markedEncodingOf(bytes: Readonly<Uint8Array>): string | undefined {
  return byteOrderMarks.find(([mark]) => mark.every((byte, at) => bytes[at] === byte))?.[1];
}

function decoderOf(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding);
  } catch {
    return new TextDecoder('utf-8');
  }
}

export function plainTextOf(bytes: Readonly<Uint8Array>, { charset }: DocumentType): Promise<DocumentRead> {
  const decoder = decoderOf(markedEncodingOf(bytes) ?? charset ?? 'utf-8');
  return Promise.resolve(textRead(decoder.decode(viewOf(bytes))));
}
