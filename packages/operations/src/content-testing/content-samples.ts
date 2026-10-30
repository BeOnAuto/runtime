import { Effect, Function } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { sha256Digest } from '../content/content-digest.ts';
import type { Digested } from '../content/recorded-content.ts';
import type { ContentToKeep, StreamedContent } from '../content/streamed-content.ts';

export const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export const beta: PlaybookAddress = { org: 'acme', playbook: 'beta' };

export const octets = 'application/octet-stream';

export const json = 'application/json';

const pieceBytes = 65_537;

export interface ReadThrough extends Digested {
  readonly largestPiece: number;
}

export interface ReadBack extends ReadThrough {
  readonly mediaType: string;
  readonly declared: number;
}

export interface Generated {
  readonly sha256: string;
  readonly bytes: number;
  readonly content: () => ContentToKeep;
}

export interface Unread {
  readonly content: ContentToKeep;
  readonly cancelled: () => boolean;
}

export interface Delivered {
  readonly bytes: number;
  readonly failure: unknown;
}

export function generatedStream(bytes: number, seed: number): ReadableStream<Uint8Array> {
  let state = seed;
  let produced = 0;
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const size = Math.min(pieceBytes, bytes - produced);
      if (size === 0) {
        controller.close();
        return;
      }
      const piece = new Uint8Array(size);
      for (let index = 0; index < size; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        piece[index] = state & 0xff;
      }
      produced += size;
      controller.enqueue(piece);
    },
  });
}

export async function readThrough(stream: ReadableStream<Uint8Array>): Promise<ReadThrough> {
  const digest = sha256Digest();
  let bytes = 0;
  let largestPiece = 0;
  for await (const piece of stream) {
    digest.update(piece);
    bytes += piece.byteLength;
    largestPiece = Math.max(largestPiece, piece.byteLength);
  }
  return { bytes, sha256: digest.hex(), largestPiece };
}

export async function generated(bytes: number, seed = 7): Promise<Generated> {
  const { sha256 } = await readThrough(generatedStream(bytes, seed));
  return { sha256, bytes, content: () => ({ stream: generatedStream(bytes, seed), mediaType: octets }) };
}

export async function readBack(content: StreamedContent | undefined): Promise<ReadBack | undefined> {
  return content === undefined
    ? content
    : { ...(await readThrough(content.stream)), mediaType: content.mediaType, declared: content.bytes };
}

export async function deliveredBeforeFailing(stream: ReadableStream<Uint8Array>): Promise<Delivered> {
  let bytes = 0;
  const read = async () => {
    for await (const piece of stream) {
      bytes += piece.byteLength;
    }
  };
  const failure: unknown = await read().then(Function.constUndefined, Function.identity);
  return { bytes, failure };
}

export function resultOf<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

export function refusalOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

export function present<A, E>(effect: Effect.Effect<A | undefined, E>): Promise<A> {
  return Effect.runPromise(Effect.flatMap(effect, Effect.fromNullishOr));
}

export function unread(): Unread {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { content: { stream, mediaType: octets }, cancelled: () => cancelled };
}

export function brokenAfter(bytes: number): ContentToKeep {
  let delivered = false;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (delivered) {
        controller.error(new Error('The connection dropped'));
        return;
      }
      delivered = true;
      controller.enqueue(new Uint8Array(bytes));
    },
  });
  return { stream, mediaType: octets };
}

export function answerOfAbout(bytes: number): string {
  const rows: { readonly id: number; readonly note: string }[] = [];
  let size = 10;
  while (size < bytes) {
    const row = { id: rows.length, note: `${String(rows.length).repeat(8)} é ✓ 𝄞 \u0000 "quoted" ${'x'.repeat(40)}` };
    rows.push(row);
    size += Buffer.byteLength(JSON.stringify(row)) + 1;
  }
  return JSON.stringify({ rows });
}
