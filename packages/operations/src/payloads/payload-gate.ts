import { Clock, Effect, Random } from 'effect';

import { Unavailable } from '../outcome/unavailable.ts';

export const firstTryAgainMs = 1000;

export const mostTryAgainMs = 60_000;

export interface PayloadGate {
  readonly through: <A, E>(call: Effect.Effect<A, E>, detail: string) => Effect.Effect<A, E | Unavailable>;
}

export const noPayloadGate: PayloadGate = { through: (call) => call };

export function tryAgainAfter(failures: number, factor: number, most = mostTryAgainMs): number {
  return Math.min(most, firstTryAgainMs * 2 ** (failures - 1)) * (0.5 + factor / 2);
}

export function payloadGateOf(): PayloadGate {
  let failures = 0;
  let nextTryAt = 0;
  const closedAfterAFailure = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const factor = yield* Random.next;
    failures += 1;
    nextTryAt = now + tryAgainAfter(failures, factor);
  });
  const opened = Effect.sync(() => {
    failures = 0;
    nextTryAt = 0;
  });
  const through = <A, E>(call: Effect.Effect<A, E>, detail: string): Effect.Effect<A, E | Unavailable> =>
    Effect.flatMap(Clock.currentTimeMillis, (now): Effect.Effect<A, E | Unavailable> =>
      now < nextTryAt
        ? Effect.fail(new Unavailable({ detail }))
        : call.pipe(
            Effect.tapError((failure) => (failure instanceof Unavailable ? closedAfterAFailure : opened)),
            Effect.tap(() => opened),
          ),
    );
  return { through };
}
