import type { StreamSignal } from '@on.auto/ledger';
import { Effect } from 'effect';

import {
  earliestOf,
  earliestOfReads,
  failedNextDueRead,
  failedRoundsInMemory,
  nextDueAfter,
  nextDueRead,
  type FailedRounds,
  type NextDueRead,
} from '../loop/failed-rounds.ts';
import {
  oneWakeAtATime,
  type HostWakeUp,
  type NextWake,
  type WakeSignal,
  type WakeUpParts,
  type Woken,
} from '../loop/host-wake-up.ts';
import { wakesOf, type Wakes } from '../sweeps/wakes.ts';
import { failedAt, roundOf, type Round, type RoundParts, type RoundUpkeep } from './follower-round.ts';

export interface Upkeep extends RoundUpkeep {
  readonly nextScheduleAt: () => Effect.Effect<number | null>;
  readonly nextDeferredAt: () => Effect.Effect<number | null>;
}

export interface FollowerWork extends RoundParts, Pick<WakeUpParts, 'sweepEveryMs' | 'context'> {
  readonly upkeep: Upkeep;
  readonly appended: StreamSignal;
}

const startedRound: Round = { owed: true, heldUntil: null, failed: false };

function startOf(parts: FollowerWork, now: number): Effect.Effect<Round> {
  return Effect.andThen(parts.sweeps.started(), parts.discovery.atStart()).pipe(
    Effect.as(startedRound),
    Effect.catchCause(
      failedAt(
        parts,
        now,
        'The follower of the playbooks could not find the playbooks at its start; it tries again at the next sweep, within a minute, twice as long after each try that fails in a row, at most an hour',
      ),
    ),
  );
}

interface Following {
  readonly started: boolean;
  readonly round: Round;
}

function startDue({ started, round }: Following, { now, sweep }: Woken): boolean {
  return !started && (sweep || !round.failed || now >= round.heldUntil);
}

function nextScheduleOf({ upkeep, trouble }: FollowerWork): Effect.Effect<NextDueRead> {
  return upkeep.nextScheduleAt().pipe(
    Effect.map(nextDueRead),
    Effect.catchCause((cause) =>
      Effect.as(
        trouble(
          'The next due time of the schedules could not be read; the follower reads it again within a minute, twice as long after each failure in a row, at most an hour',
          cause,
        ),
        failedNextDueRead(null),
      ),
    ),
  );
}

function nextScheduleToComeOf(parts: FollowerWork, now: number): Effect.Effect<number | null> {
  return Effect.map(nextScheduleOf(parts), ({ nextDueAt }) =>
    nextDueAt !== null && nextDueAt > now ? nextDueAt : null,
  );
}

function nextDeferredOf({ upkeep, trouble, sweepEveryMs }: FollowerWork, now: number): Effect.Effect<NextDueRead> {
  return upkeep.nextDeferredAt().pipe(
    Effect.map((due) => nextDueRead(due === null || due > now ? due : now + sweepEveryMs)),
    Effect.catchCause((cause) =>
      Effect.as(
        trouble(
          'The next due time of the starts that wait could not be read; the follower reads it again within a minute, twice as long after each failure in a row, at most an hour',
          cause,
        ),
        failedNextDueRead(null),
      ),
    ),
  );
}

interface KeptBetweenWakes {
  readonly wakes: Wakes;
  readonly failedReads: FailedRounds;
}

function nextWakeOf(
  parts: FollowerWork,
  { wakes, failedReads }: KeptBetweenWakes,
  round: Round,
  now: number,
): Effect.Effect<NextWake> {
  if (round.failed) {
    return Effect.map(nextScheduleToComeOf(parts, now), (toCome) => ({
      nextDueAt: earliestOf(toCome, round.heldUntil),
    }));
  }
  return wakes.anyWoken() || round.owed
    ? Effect.succeed({ nextDueAt: now })
    : Effect.zipWith(nextScheduleOf(parts), nextDeferredOf(parts, now), (schedule, deferred) =>
        earliestOfReads([schedule, deferred]),
      ).pipe(
        Effect.flatMap((read) => nextDueAfter(read, { failedReads, clock: parts.clock })),
        Effect.map((due) => ({ nextDueAt: earliestOf(due, round.heldUntil) })),
      );
}

export function followerWakeUpOf(parts: FollowerWork, signal: WakeSignal): HostWakeUp {
  const kept: KeptBetweenWakes = { wakes: wakesOf(), failedReads: failedRoundsInMemory() };
  const state: { started: boolean; round: Round } = {
    started: false,
    round: { owed: false, heldUntil: null, failed: false },
  };
  const stopListening = parts.appended.listen((stream) => {
    kept.wakes.woken(stream);
    signal.raised();
  });
  const startedNow = (woken: Woken): Effect.Effect<void> =>
    startDue(state, woken)
      ? Effect.map(startOf(parts, woken.now), (round) => {
          state.started = !round.failed;
          state.round = round;
        })
      : Effect.void;
  return {
    wakeUp: oneWakeAtATime(({ now, sweep }) =>
      startedNow({ now, sweep }).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            state.started
              ? Effect.map(
                  Effect.uninterruptible(roundOf(parts, kept.wakes, { now, sweep: sweep || state.round.owed })),
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
          state.started
            ? nextWakeOf(parts, kept, state.round, now)
            : Effect.succeed({ nextDueAt: state.round.heldUntil }),
        ),
      ),
    ),
    stop: () =>
      Effect.sync(() => {
        stopListening();
      }),
  };
}
