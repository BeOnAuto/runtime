import { Effect, Fiber, type Cause } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import { forkedIn, ranIn, type HostContext } from '../loop/forked-fibers.ts';
import type { HostClock } from '../loop/host-clock.ts';
import type { HostLease, LeaseClaim } from './host-lease.ts';

type Standing = 'unknown' | 'holding' | 'standing_by';

type LeaseRefusal = Extract<LeaseClaim, { readonly held: false }>;

export interface KeeperParts {
  readonly lease: HostLease;
  readonly clock: HostClock;
  readonly sweepEveryMs: number;
  readonly lastsMs: number;
  readonly held: (before: Standing) => Effect.Effect<void>;
  readonly standingBy: (refusal: LeaseRefusal, before: Standing) => Effect.Effect<void>;
  readonly trouble: Trouble;
  readonly context?: HostContext;
}

export interface LeaseKeeper {
  readonly stop: () => Promise<void>;
}

const unknownHolder = 'unknown, since the database could not be read';

export async function keptLease(parts: KeeperParts): Promise<LeaseKeeper> {
  const { lease, clock, sweepEveryMs, lastsMs, trouble } = parts;
  const state: { standing: Standing; renewedAt: number } = {
    standing: 'unknown',
    renewedAt: Number.NEGATIVE_INFINITY,
  };
  const claimed = (claim: LeaseClaim): Effect.Effect<void> => {
    const before = state.standing;
    if (claim.held) {
      state.renewedAt = clock.now();
      state.standing = 'holding';
      return before === 'holding' ? Effect.void : parts.held(before);
    }
    state.standing = 'standing_by';
    return before === 'standing_by' ? Effect.void : parts.standingBy(claim, before);
  };
  const unrenewed = (cause: Cause.Cause<unknown>): Effect.Effect<void> => {
    const lapsed = state.standing === 'holding' && clock.now() - state.renewedAt >= lastsMs;
    return Effect.andThen(
      trouble('The claim of this server on the workflows of its database could not be renewed', cause),
      lapsed ? claimed({ held: false, holder: unknownHolder, until: state.renewedAt + lastsMs }) : Effect.void,
    );
  };
  const kept = lease.claimed().pipe(Effect.flatMap(claimed), Effect.catchCause(unrenewed));
  await ranIn(parts.context, kept);
  const fiber = forkedIn(
    parts.context,
    Effect.forever(Effect.andThen(Effect.sleep(sweepEveryMs), Effect.uninterruptible(kept))),
  );
  return { stop: () => Effect.runPromise(Effect.asVoid(Fiber.interrupt(fiber))) };
}
