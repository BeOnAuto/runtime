import { mediaTypeOfBody, type StreamedBody, type StreamedContent } from '@on.auto/operations';
import { Result } from 'effect';

import type { Problem } from '../problem/problem-document.ts';
import { problemOf } from '../problem/problem.ts';
import { bodyEncoded, bodyNotUtf8, bodySentAsAnother, bodyTooLarge } from './body-problems.ts';
import { isIdentity, mediaTypeOf } from './request-body.ts';

const lengthRequired = Result.fail(problemOf('length_required', 'A body must be sent with a Content-Length'));

const malformedLength = Result.fail(problemOf('bad_request', 'The Content-Length must be a whole number of bytes'));

const wholeNumber = /^\d+$/u;

function sizeOf(length: string | null, mostBytes: number): Result.Result<number, Problem> {
  if (length === null) {
    return lengthRequired;
  }
  if (!wholeNumber.test(length)) {
    return malformedLength;
  }
  const bytes = Number(length);
  return bytes > mostBytes ? bodyTooLarge(mostBytes) : Result.succeed(bytes);
}

export function streamedBodyOf(
  request: Request,
  { kind, mostBytes }: StreamedBody,
): Result.Result<StreamedContent, Problem> {
  const mediaType = mediaTypeOfBody[kind];
  const sent = mediaTypeOf(request.headers.get('content-type'));
  if (!isIdentity(request.headers.get('content-encoding'))) {
    return bodyEncoded;
  }
  if (sent.type !== mediaType) {
    return bodySentAsAnother(mediaType);
  }
  if (sent.charset !== undefined && sent.charset !== 'utf-8') {
    return bodyNotUtf8;
  }
  return Result.map(sizeOf(request.headers.get('content-length'), mostBytes), (bytes) => ({
    stream: request.body ?? new Blob().stream(),
    bytes,
    mediaType,
  }));
}
