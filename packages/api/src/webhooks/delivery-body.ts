import { Buffer } from 'node:buffer';

import { Function, Result } from 'effect';

import { bodyEncoded, bodyTooLarge } from '../operations/body-problems.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf } from '../problem/problem.ts';

export interface BodyBounds {
  readonly bodyBytes: number;
  readonly bodyWaitMs: number;
}

type Read =
  | { readonly kind: 'read'; readonly bytes: Readonly<Uint8Array> }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'too_slow' }
  | { readonly kind: 'unreadable' };

const tooSlow: Read = { kind: 'too_slow' };

const unreadable: Read = { kind: 'unreadable' };

function isIdentity(contentEncoding: string | null): boolean {
  return contentEncoding === null || ['', 'identity'].includes(contentEncoding.trim().toLowerCase());
}

const tooLarge: Read = { kind: 'too_large' };

function chunksOf(reader: ReadableStreamDefaultReader<Uint8Array>, mostBytes: number): Promise<Read> {
  const chunks: Uint8Array[] = [];
  const readOn = async (size: number): Promise<Read> => {
    const read = await reader.read();
    if (read.done) {
      return { kind: 'read', bytes: Uint8Array.from(Buffer.concat(chunks)) };
    }
    const grown = size + read.value.byteLength;
    if (grown > mostBytes) {
      return tooLarge;
    }
    chunks.push(read.value);
    return readOn(grown);
  };
  return readOn(0);
}

async function readWithin(body: ReadableStream<Uint8Array>, { bodyBytes, bodyWaitMs }: BodyBounds): Promise<Read> {
  const reader = body.getReader();
  const late = Promise.withResolvers<Read>();
  const timer = setTimeout(() => {
    late.resolve(tooSlow);
  }, bodyWaitMs);
  const read = await Promise.race([chunksOf(reader, bodyBytes).catch((): Read => unreadable), late.promise]);
  clearTimeout(timer);
  if (read.kind !== 'read') {
    await reader.cancel().catch(Function.constVoid);
  }
  return read;
}

function problemOfRead(read: Exclude<Read, { readonly kind: 'read' }>, { bodyBytes, bodyWaitMs }: BodyBounds) {
  if (read.kind === 'too_large') {
    return bodyTooLarge(bodyBytes);
  }
  return Result.fail(
    read.kind === 'too_slow'
      ? problemOf('request_timeout', `The body did not arrive within ${bodyWaitMs / 1000} seconds`)
      : problemOf('bad_request', 'The body could not be read'),
  );
}

export async function deliveryBodyOf(
  request: Request,
  bounds: BodyBounds,
): Promise<Result.Result<Uint8Array, Problem>> {
  if (!isIdentity(request.headers.get('content-encoding'))) {
    return bodyEncoded;
  }
  if (Number(request.headers.get('content-length')) > bounds.bodyBytes) {
    return bodyTooLarge(bounds.bodyBytes);
  }
  if (request.body === null) {
    return Result.succeed(new Uint8Array());
  }
  const read = await readWithin(request.body, bounds);
  return read.kind === 'read' ? Result.succeed(read.bytes) : problemOfRead(read, bounds);
}
