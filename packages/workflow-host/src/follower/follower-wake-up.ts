import type { StreamSignal } from '@on.auto/ledger';
import { Effect } from 'effect';

import {
  oneWakeAtATime,
  type HostWakeUp,
  type NextWake,
  type WakeSignal,
  type WakeUpParts,
  type Woken,
} from '../loop/host-wake-up.ts';
import { wakesOf, type Wakes } from '../sweeps/wakes.ts';
import { earliestOf, failedAt, roundOf, type Round, type RoundParts, type RoundUpkeep } from './follower-round.ts';

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
  const state: { started: boolean; round: Round } = {
    started: false,
    round: { owed: false, heldUntil: null, failed: false },
  };
  const stopListening = parts.appended.listen((stream) => {
    wakes.woken(stream);
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
          state.started
            ? nextWakeOf(parts, wakes, state.round, now)
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
