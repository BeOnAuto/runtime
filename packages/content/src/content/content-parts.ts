import type { StreamedBytes } from './streamed-content.ts';

export interface AskedRange {
  readonly start: number;
  readonly end: number | undefined;
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export type StreamedPart = StreamedBytes & ByteRange;

export interface ContentPart {
  readonly size: number;
  readonly mediaType: string;
  readonly part: StreamedPart | undefined;
}

export function bytesIn({ start, end }: ByteRange): number {
  return end - start + 1;
}

export function rangeWithin({ start, end }: AskedRange, size: number): ByteRange | undefined {
  const last = Math.min(end ?? size - 1, size - 1);
  const startsWithin = Number.isInteger(start) && start >= 0 && start < size;
  const endsFromItsStart = end === undefined || end >= start;
  return startsWithin && endsFromItsStart && Number.isInteger(last) ? { start, end: last } : undefined;
}

export function streamedPartOf(range: ByteRange, stream: ReadableStream<Uint8Array>): StreamedPart {
  return { ...range, bytes: bytesIn(range), stream };
}

export function contentPartOf(
  size: number,
  mediaType: string,
  asked: AskedRange,
  streamOf: (range: ByteRange) => ReadableStream<Uint8Array>,
): ContentPart {
  const range = rangeWithin(asked, size);
  return { size, mediaType, part: range === undefined ? undefined : streamedPartOf(range, streamOf(range)) };
}
