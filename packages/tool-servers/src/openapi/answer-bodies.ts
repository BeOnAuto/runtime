import { documentBounds, unreadDocuments, type DocumentGiven, type DocumentText } from '@on.auto/documents';
import { boundedAnswerOf } from '@on.auto/outbound';

import { measured, toolBounds } from '../bounds/call-bounds.ts';
import { DocumentTooLarge } from './document-too-large.ts';

export interface AnsweredFile {
  readonly named: string | undefined;
  readonly read: (given: DocumentGiven, textBytes: number) => Promise<DocumentText>;
}

export const unreadFiles: AnsweredFile = {
  named: undefined,
  read: (given, textBytes) => unreadDocuments(given, { deadlineMs: 0, signal: undefined, textBytes }),
};

const fileNameParameters = /(?:^|;)\s*(filename\*?)\s*=\s*("(?:[^"\\]|\\.)*"|[^;\s]*)/giu;

const extendedValue = /^([\w!#$%&+^`{|}~-]+)'[^']*'(.*)$/u;

const percentEncoded = /%([\dA-Fa-f]{2})/gu;

const forgingCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}[\]]/gu;

const mostNameCharacters = 255;

function unquoted(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll(/\\(.)/gu, '$1') : value;
}

function latin1Decoded(encoded: string): string {
  return encoded.replaceAll(percentEncoded, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

function utf8Decoded(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

const charsetDecoders: ReadonlyMap<string, (encoded: string) => string | undefined> = new Map([
  ['utf-8', utf8Decoded],
  ['iso-8859-1', latin1Decoded],
]);

function extendedDecoded(value: string): string | undefined {
  const parts = extendedValue.exec(value);
  return parts === null ? undefined : charsetDecoders.get(String(parts[1]).toLowerCase())?.(String(parts[2]));
}

function fileNameIn(disposition: string | null): string {
  const written = new Map<string, string>();
  for (const [, parameter, value] of (disposition ?? '').matchAll(fileNameParameters)) {
    written.set(String(parameter).toLowerCase(), String(value));
  }
  return extendedDecoded(written.get('filename*') ?? '') ?? unquoted(written.get('filename') ?? '');
}

function shownName(name: string): string | undefined {
  const shown = Array.from(name.replaceAll(forgingCharacters, ' ').trim()).slice(0, mostNameCharacters).join('').trim();
  return shown === '' ? undefined : shown;
}

function headLineOf(name: string | undefined, mediaType: string, size: string): string {
  return `[${name === undefined ? 'The answer' : `The file ${name}`}, ${mediaType}, ${size}]`;
}

async function bytesWithinTheBound(response: Readonly<Response>): Promise<Uint8Array> {
  let larger = false;
  try {
    const bounded = boundedAnswerOf(response, documentBounds.bytes, () => {
      larger = true;
    });
    return new Uint8Array(await bounded.arrayBuffer());
  } catch (error) {
    throw larger ? new DocumentTooLarge() : error;
  }
}

export function shownTextOf(response: Readonly<Response>, tooLarge: () => void): Promise<string> {
  return boundedAnswerOf(response, toolBounds.httpAnswerBytes, tooLarge).text();
}

const headLineRoom = 2048;

const documentTextBytes = toolBounds.httpAnswerBytes - headLineRoom;

export async function fileTextOf(response: Readonly<Response>, { named, read }: AnsweredFile): Promise<string> {
  const name = shownName(fileNameIn(response.headers.get('content-disposition'))) ?? shownName(named ?? '');
  const bytes = await bytesWithinTheBound(response);
  const size = bytes.byteLength;
  if (size === 0) {
    return '';
  }
  const document = await read(
    { bytes, mediaType: response.headers.get('content-type') ?? '', name },
    documentTextBytes,
  );
  const line = headLineOf(name, document.mediaType, `${measured(size)} bytes`);
  return `${line}\n${document.read ? document.text : document.because}`;
}
