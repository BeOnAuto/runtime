import { Result } from 'effect';

import type { Problem } from '../problem/problem-document.ts';
import { problemOf } from '../problem/problem.ts';

export const bodyEncoded = Result.fail(
  problemOf('unsupported_media_type', 'A body must be sent without a Content-Encoding other than identity'),
);

export const bodyNotUtf8 = Result.fail(problemOf('unsupported_media_type', 'A body must be encoded as UTF-8'));

export function bodySentAsAnother(mediaType: string): Result.Result<never, Problem> {
  return Result.fail(problemOf('unsupported_media_type', `A body must be sent as ${mediaType}`));
}

export function bodyTooLarge(mostBytes: number): Result.Result<never, Problem> {
  return Result.fail(
    problemOf(
      'content_too_large',
      `The body is larger than the ${mostBytes.toLocaleString('en-US')} bytes this operation takes`,
    ),
  );
}
