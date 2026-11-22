import { Schema } from 'effect';

import { Conflict, ConflictKindSchema } from './conflict.ts';
import { Forbidden, ForbiddenKindSchema } from './forbidden.ts';
import { NotFound } from './not-found.ts';
import type { Rejected } from './outcome.ts';
import { Unavailable, UnavailableKindSchema } from './unavailable.ts';

export type TypedRejection = Forbidden | NotFound | Conflict | Unavailable;

const isForbiddenKind = Schema.is(ForbiddenKindSchema);

const isConflictKind = Schema.is(ConflictKindSchema);

const isUnavailableKind = Schema.is(UnavailableKindSchema);

function unavailableOf({ detail, kind, retry_after: retryAfter }: Rejected): Unavailable {
  return new Unavailable({
    detail,
    ...(isUnavailableKind(kind) ? { kind } : {}),
    ...(retryAfter === undefined ? {} : { retry_after: retryAfter }),
  });
}

export function typedRejectionOf(rejection: Rejected): TypedRejection {
  const { reason, detail, kind } = rejection;
  if (reason === 'forbidden') {
    return new Forbidden(isForbiddenKind(kind) ? { detail, kind } : { detail });
  }
  if (reason === 'not_found') {
    return new NotFound({ detail });
  }
  if (reason === 'unavailable') {
    return unavailableOf(rejection);
  }
  return new Conflict(isConflictKind(kind) ? { detail, kind } : { detail });
}
