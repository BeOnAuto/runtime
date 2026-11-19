import { Schema } from 'effect';

import { Conflict, ConflictKindSchema } from './conflict.ts';
import { Forbidden, ForbiddenKindSchema } from './forbidden.ts';
import { NotFound } from './not-found.ts';
import type { Rejected } from './outcome.ts';
import { Unavailable } from './unavailable.ts';

export type TypedRejection = Forbidden | NotFound | Conflict | Unavailable;

const isForbiddenKind = Schema.is(ForbiddenKindSchema);

const isConflictKind = Schema.is(ConflictKindSchema);

export function typedRejectionOf({ reason, detail, kind }: Rejected): TypedRejection {
  if (reason === 'forbidden') {
    return new Forbidden(isForbiddenKind(kind) ? { detail, kind } : { detail });
  }
  if (reason === 'not_found') {
    return new NotFound({ detail });
  }
  if (reason === 'unavailable') {
    return new Unavailable({ detail });
  }
  return new Conflict(isConflictKind(kind) ? { detail, kind } : { detail });
}
