import { Conflict } from '@on.auto/operations';
import { Data, Effect, Predicate } from 'effect';

const versionConflictTag = 'version_conflict';

export class VersionConflict extends Data.TaggedError(versionConflictTag) {}

export function isVersionConflict(error: unknown): boolean {
  return Predicate.isTagged(error, versionConflictTag);
}

const retriesOnVersionConflict = 3;

const changedWhileDeciding = 'The state changed while the command was decided';

export function retriedOnVersionConflict<A>(attempt: Effect.Effect<A, VersionConflict>): Effect.Effect<A, Conflict> {
  return attempt.pipe(
    Effect.retry({ times: retriesOnVersionConflict }),
    Effect.mapError(() => new Conflict({ detail: changedWhileDeciding, kind: 'concurrent_change' })),
  );
}
