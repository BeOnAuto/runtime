import { Data } from 'effect';

import type { Digested } from './recorded-content.ts';

export type ContentRefusedBecause = 'not_its_digest' | 'not_its_size' | 'stream_failed';

export class ContentRefused extends Data.TaggedError('content_refused')<{
  readonly because: ContentRefusedBecause;
  readonly detail: string;
  readonly found?: Digested;
  readonly cause?: unknown;
}> {}

export function notItsDigest(found: Digested, expected: string): ContentRefused {
  return new ContentRefused({
    because: 'not_its_digest',
    detail: `The content's SHA-256 is ${found.sha256}, where ${expected} was expected`,
    found,
  });
}

export function notItsSize(found: Digested, expected: number): ContentRefused {
  return new ContentRefused({
    because: 'not_its_size',
    detail: `The content holds ${found.bytes} bytes, where ${expected} were expected`,
    found,
  });
}

export function streamFailed(cause: unknown): ContentRefused {
  return new ContentRefused({ because: 'stream_failed', detail: "The content's stream failed before its end", cause });
}

export function notTheBytesOfItsDigest(sha256: string): Error {
  return new Error(`The content kept under ${sha256} is not the bytes that digest names`);
}
