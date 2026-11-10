import { Effect } from 'effect';

import { Unavailable } from '../outcome/unavailable.ts';

export const payloadWaitMs = 5000;

export const payloadBytesASecond = 256 * 1024;

export function payloadWaitOf(bytes: number): number {
  return payloadWaitMs + Math.ceil((bytes * 1000) / payloadBytesASecond);
}

export function unreachable(detail: string, sha256: string, failure: unknown): Effect.Effect<never, Unavailable> {
  return Effect.logWarning(`The content store did not answer for ${sha256}`, failure).pipe(
    Effect.andThen(Effect.fail(new Unavailable({ detail }))),
  );
}

export function waitedFor<A, E>(
  effect: Effect.Effect<A, E>,
  bytes: number,
  { detail, sha256 }: { readonly detail: string; readonly sha256: string },
): Effect.Effect<A, E | Unavailable> {
  const waitMs = payloadWaitOf(bytes);
  return Effect.timeoutOrElse(effect, {
    duration: waitMs,
    orElse: () => unreachable(detail, sha256, `no answer within ${waitMs} ms`),
  });
}
