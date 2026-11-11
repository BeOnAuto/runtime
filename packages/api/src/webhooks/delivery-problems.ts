import { Result } from 'effect';

import { jsonObjectOfText, type JsonObject } from '../operations/request-body.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

export type DeliveryOutcome =
  | 'answered'
  | 'refused'
  | 'malformed'
  | 'unsigned'
  | 'stale'
  | 'unread'
  | 'unknown'
  | 'not_signed'
  | 'limited'
  | 'lookup_limited'
  | 'replayed'
  | 'unreadable';

const notSignedByTheConnection = problemOf(
  'unauthenticated',
  'The delivery is not signed by the connection its address names',
);

const notUtf8 = Result.fail(problemOf('bad_request', 'The body could not be read as UTF-8 text'));

export const deliveryProblems = {
  unsigned: () => problemResponse(notSignedByTheConnection),
  limited: (seconds: number) =>
    problemResponse(
      problemOf(
        'too_many_requests',
        'The connection sent more deliveries in this minute than the runtime takes; send this one again later',
      ),
      { 'retry-after': String(seconds) },
    ),
  lookupLimited: (seconds: number) =>
    problemResponse(
      problemOf(
        'too_many_requests',
        "The runtime looked up as many connections' keys in this minute as it takes; send this delivery again after the time in Retry-After",
      ),
      { 'retry-after': String(seconds) },
    ),
  of: (problem: Problem) => problemResponse(problem),
};

export function answerBodyOf(
  bytes: Readonly<Uint8Array>,
  contentType: string | null,
): Result.Result<JsonObject, Problem> {
  try {
    return jsonObjectOfText(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), contentType);
  } catch {
    return notUtf8;
  }
}
