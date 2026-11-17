import type { StreamSignal } from '@on.auto/ledger';
import { Effect } from 'effect';

import {
  oneWakeAtATime,
  type HostWakeUp,
  type NextWake,
  type WakeSignal,
  type WakeUpParts,
} from '../loop/host-wake-up.ts';
import { wakesOf, type Wakes } from '../sweeps/wakes.ts';
import { earliestOf, roundOf, type Round, type RoundParts, type RoundUpkeep } from './follower-round.ts';

export interface Upkeep extends RoundUpkeep {
  readonly nextScheduleAt: () => Effect.Effect<number | null>;
  readonly nextDeferredAt: () => Effect.Effect<number | null>;
}

export interface FollowerWork extends RoundParts, Pick<WakeUpParts, 'sweepEveryMs' | 'context'> {
  readonly upkeep: Upkeep;
  readonly appended: StreamSignal;
}

function startedOf({ sweeps, discovery, trouble }: FollowerWork): Effect.Effect<boolean> {
  return Effect.andThen(sweeps.started(), discovery.atStart()).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.as(
        trouble(
          'The follower of the playbooks could not find the playbooks at its start; it tries again at the next sweep',
          cause,
        ),
        false,
      ),
    ),
  );
}

function nextScheduleOf({ upkeep, trouble }: FollowerWork): Effect.Effect<number | null> {
  return upkeep
    .nextScheduleAt()
    .pipe(
      Effect.catchCause((cause) =>
        Effect.as(
          trouble('The next due time of the schedules could not be read; the follower waits for the next sweep', cause),
          null,
        ),
      ),
    );
}

function nextScheduleToComeOf(parts: FollowerWork, now: number): Effect.Effect<number | null> {
  return Effect.map(nextScheduleOf(parts), (due) => (due !== null && due > now ? due : null));
}

function nextDeferredOf({ upkeep, trouble, sweepEveryMs }: FollowerWork, now: number): Effect.Effect<number | null> {
  return upkeep.nextDeferredAt().pipe(
    Effect.map((due) => (due === null || due > now ? due : now + sweepEveryMs)),
    Effect.catchCause((cause) =>
      Effect.as(
        trouble(
          'The next due time of the starts that wait could not be read; the follower waits for the next sweep',
          cause,
        ),
        null,
      ),
    ),
  );
}

function nextWakeOf(parts: FollowerWork, wakes: Wakes, round: Round, now: number): Effect.Effect<NextWake> {
  if (round.failed) {
    return Effect.map(nextScheduleToComeOf(parts, now), (toCome) => ({
      nextDueAt: earliestOf(toCome, round.heldUntil),
    }));
  }
  return wakes.anyWoken() || round.owed
    ? Effect.succeed({ nextDueAt: now })
    : Effect.zipWith(nextScheduleOf(parts), nextDeferredOf(parts, now), (schedule, deferredAt) => ({
        nextDueAt: earliestOf(earliestOf(schedule, deferredAt), round.heldUntil),
      }));
}

export function followerWakeUpOf(parts: FollowerWork, signal: WakeSignal): HostWakeUp {
  const wakes = wakesOf();
  const state: { started: boolean; tried: boolean; round: Round } = {
    started: false,
    tried: false,
    round: { owed: false, heldUntil: null, failed: false },
  };
  const stopListening = parts.appended.listen((stream) => {
    wakes.woken(stream);
    signal.raised();
  });
  const startedNow = (sweep: boolean): Effect.Effect<void> =>
    state.started || (state.tried && !sweep)
      ? Effect.void
      : Effect.map(startedOf(parts), (started) => {
          state.tried = true;
          state.started = started;
          state.round = { ...state.round, owed: started };
        });
  return {
    wakeUp: oneWakeAtATime(({ now, sweep }) =>
      startedNow(sweep).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            state.started
              ? Effect.map(
                  Effect.uninterruptible(roundOf(parts, wakes, { now, sweep: sweep || state.round.owed })),
                  (round) => {
                    state.round = round;
                  },
                )
              : Effect.void,
          ),
        ),
        Effect.andThen(
          Effect.sync(() => {
            signal.renewed();
          }),
        ),
        Effect.andThen(() =>
          state.started ? nextWakeOf(parts, wakes, state.round, now) : Effect.succeed({ nextDueAt: null }),
        ),
      ),
    ),
    stop: () =>
      Effect.sync(() => {
        stopListening();
      }),
  };
}
