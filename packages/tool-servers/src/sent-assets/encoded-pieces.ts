import { Buffer } from 'node:buffer';

import type { SentEncoding } from './sent-encodings.ts';

const encoder = new TextEncoder();

const quote = encoder.encode('"');

const base64Group = 3;

function escaped(text: string): Uint8Array {
  return encoder.encode(JSON.stringify(text).slice(1, -1));
}

type Controller = Readonly<TransformStreamDefaultController<Uint8Array>>;

function quoted(controller: Controller): void {
  controller.enqueue(quote);
}

function quotedText(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder('utf-8');
  return new TransformStream({
    start: quoted,
    transform: (piece: Readonly<Uint8Array>, controller: Controller) => {
      controller.enqueue(escaped(decoder.decode(piece, { stream: true })));
    },
    flush: (controller: Controller) => {
      controller.enqueue(escaped(decoder.decode()));
      quoted(controller);
    },
  });
}

function base64Of(bytes: Readonly<Uint8Array>): Uint8Array {
  return encoder.encode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'));
}

function quotedBase64(): TransformStream<Uint8Array, Uint8Array> {
  let carried: Readonly<Uint8Array> = new Uint8Array(0);
  return new TransformStream({
    start: quoted,
    transform: (piece: Readonly<Uint8Array>, controller: Controller) => {
      const joined = Buffer.concat([carried, piece]);
      const whole = joined.byteLength - (joined.byteLength % base64Group);
      controller.enqueue(base64Of(joined.subarray(0, whole)));
      carried = joined.subarray(whole);
    },
    flush: (controller: Controller) => {
      controller.enqueue(base64Of(carried));
      quoted(controller);
    },
  });
}

function asTheyAre(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream();
}

const encodings: Readonly<Record<SentEncoding, () => TransformStream<Uint8Array, Uint8Array>>> = {
  text: quotedText,
  base64: quotedBase64,
  json: asTheyAre,
};

export function encodedAs(encoding: SentEncoding, content: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return content.pipeThrough(encodings[encoding]());
}

export function base64Bytes(bytes: number): number {
  return quote.byteLength * 2 + 4 * Math.ceil(bytes / base64Group);
}

export async function bytesRead(stream: ReadableStream<Uint8Array>): Promise<number> {
  let bytes = 0;
  for await (const piece of stream) {
    bytes += piece.byteLength;
  }
  return bytes;
}
