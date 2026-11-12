import { Effect } from 'effect';

import type { ContentToKeep } from './streamed-content.ts';

export function expiryOf({ expiresAt }: Pick<ContentToKeep, 'expiresAt'>): Effect.Effect<number | undefined> {
  return expiresAt === undefined || Number.isSafeInteger(expiresAt)
    ? Effect.succeed(expiresAt)
    : Effect.die(new RangeError(`A content to keep expires at ${expiresAt}, which is no whole number of milliseconds`));
}

export function requireABatch(most: number): Effect.Effect<void> {
  return Number.isSafeInteger(most) && most > 0
    ? Effect.void
    : Effect.die(
        new RangeError(`An erasure of expired content was asked for ${most} heads, where it takes one or more`),
      );
}
