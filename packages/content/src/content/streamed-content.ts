import { Effect } from 'effect';

import { textPieces } from './text-pieces.ts';

export interface StreamedBytes {
  readonly stream: ReadableStream<Uint8Array>;
  readonly bytes: number;
}

export interface StreamedContent extends StreamedBytes {
  readonly mediaType: string;
}

export interface ExpectedContent {
  readonly sha256?: string;
  readonly bytes?: number;
}

export interface ContentToKeep {
  readonly stream: ReadableStream<Uint8Array>;
  readonly mediaType: string;
  readonly expected?: ExpectedContent;
  readonly expiresAt?: number;
}

export function contentOfText(text: string, mediaType: string): StreamedContent {
  const blob = new Blob([text]);
  return { stream: blob.stream(), bytes: blob.size, mediaType };
}

export function contentOfBytes(bytes: Readonly<Uint8Array>, mediaType: string): StreamedContent {
  const blob = new Blob([new Uint8Array(bytes)]);
  return { stream: blob.stream(), bytes: blob.size, mediaType };
}

const encoder = new TextEncoder();

function encodedInPieces(text: string): ReadableStream<Uint8Array> {
  const pieces = textPieces(text);
  return new ReadableStream({
    pull: (controller) => {
      const next = pieces.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value));
    },
  });
}

export function textToKeep(text: string, mediaType: string): ContentToKeep {
  return { stream: encodedInPieces(text), mediaType };
}

async function decoded(stream: ReadableStream<Uint8Array>): Promise<string> {
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let text = '';
  for await (const part of stream) {
    text += utf8.decode(part, { stream: true });
  }
  return `${text}${utf8.decode()}`;
}

export function textOfContent({ stream }: StreamedBytes): Effect.Effect<string> {
  return Effect.promise(() => decoded(stream));
}
