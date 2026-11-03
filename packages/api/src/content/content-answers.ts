import type { AskedRange, ContentOwner, ContentPart, RecordedContent, StreamedBytes } from '@on.auto/content';
import { Effect } from 'effect';

import { problemOf, problemResponse } from '../problem/problem.ts';

export type ServedContent = Pick<RecordedContent, 'get' | 'getPart'>;

export interface Addressed {
  readonly playbook: ContentOwner;
  readonly sha256: string;
}

export interface Answering {
  readonly secondsLeft: number;
  readonly headOnly: boolean;
  readonly range: string | undefined;
}

interface Answered {
  readonly status: number;
  readonly mediaType: string;
  readonly headers: Readonly<Record<string, string>>;
}

const oneRange = /^bytes=(\d+)-(\d*)$/u;

const rangesAccepted = { 'accept-ranges': 'bytes' };

const notHeld = problemOf('not_found', 'The playbook holds no content under this digest');

function askedRangeOf(header: string | undefined): AskedRange | undefined {
  const [, start, end = ''] = oneRange.exec(header ?? '') ?? [];
  if (start === undefined) {
    return undefined;
  }
  const asked = { start: Number(start), end: end === '' ? undefined : Number(end) };
  return asked.end === undefined || asked.end >= asked.start ? asked : undefined;
}

async function contentAnswer(
  { stream }: Pick<StreamedBytes, 'stream'>,
  { status, mediaType, headers: own }: Answered,
  { secondsLeft, headOnly }: Answering,
): Promise<Response> {
  const headers = {
    'content-type': mediaType,
    ...own,
    ...rangesAccepted,
    'cache-control': `private, max-age=${secondsLeft}`,
  };
  if (headOnly) {
    await stream.cancel();
    return new Response(null, { status, headers });
  }
  return new Response(stream, { status, headers });
}

function rangeRefused(size: number): Response {
  return problemResponse(
    problemOf(
      'range_not_satisfiable',
      `The content holds ${String(size)} bytes, so the range asked starts past its end`,
    ),
    { ...rangesAccepted, 'content-range': `bytes */${String(size)}` },
  );
}

function partAnswer({ size, mediaType, part }: ContentPart, answering: Answering): Promise<Response> | Response {
  if (part === undefined) {
    return rangeRefused(size);
  }
  const { start, end, bytes } = part;
  const headers = {
    'content-length': String(bytes),
    'content-range': `bytes ${String(start)}-${String(end)}/${String(size)}`,
  };
  return contentAnswer(part, { status: 206, mediaType, headers }, answering);
}

export async function contentAnsweredAt(
  content: ServedContent,
  { playbook, sha256 }: Addressed,
  answering: Answering,
): Promise<Response> {
  const asked = answering.headOnly ? undefined : askedRangeOf(answering.range);
  if (asked !== undefined) {
    const kept = await Effect.runPromise(content.getPart(playbook, sha256, asked));
    return kept === undefined ? problemResponse(notHeld) : partAnswer(kept, answering);
  }
  const kept = await Effect.runPromise(content.get(playbook, sha256));
  return kept === undefined
    ? problemResponse(notHeld)
    : contentAnswer(
        kept,
        { status: 200, mediaType: kept.mediaType, headers: { 'content-length': String(kept.bytes) } },
        answering,
      );
}
