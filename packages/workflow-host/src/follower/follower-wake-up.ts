import type { StreamSignal } from '@on.auto/ledger';
import { Effect } from 'effect';

import {
  oneWakeAtATime,
  type HostWakeUp,
  type NextWake,
  type WakeSignal,
  type WakeUpParts,
} from '../loop/host-wake-up.ts';
import type { PlaybookSweeps } from '../sweeps/playbook-sweeps.ts';
import { wakesOf, type Wakes } from '../sweeps/wakes.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedPlaybook } from './followed-playbooks.ts';
import type { Discovery } from './playbook-discovery.ts';
import type { PassEnd } from './record-steps.ts';

export interface Upkeep {
  readonly sweep: () => Effect.Effect<void>;
  readonly fireSchedules: () => Effect.Effect<void>;
  readonly nextScheduleAt: () => Effect.Effect<number | null>;
}

export interface FollowerWork extends Pick<WakeUpParts, 'clock' | 'sweepEveryMs' | 'trouble' | 'context'> {
  readonly pass: (playbookKey: string, mode: Mode, known?: FollowedPlaybook) => Effect.Effect<PassEnd>;
  readonly discovery: Discovery;
  readonly sweeps: PlaybookSweeps;
  readonly upkeep: Upkeep;
  readonly appended: StreamSignal;
}

interface Passing {
  readonly playbookKey: string;
  readonly mode: Mode;
  readonly known: FollowedPlaybook | undefined;
}

function passedOnce(parts: FollowerWork, wakes: Wakes, { playbookKey, mode, known }: Passing) {
  const seen = known === undefined ? parts.discovery.playbookSeen(playbookKey) : Effect.void;
  return Effect.andThen(seen, () => parts.pass(playbookKey, mode, known)).pipe(
    Effect.tap((end) =>
      Effect.sync(() => {
        if (end === 'more') {
          wakes.playbookAgain(playbookKey);
        }
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.andThen(
        parts.trouble('A pass over a playbook failed; the next sweep passes the playbook again', cause),
        Effect.sync(() => {
          parts.sweeps.passAgain(playbookKey);
        }),
      ),
    ),
  );
}

function registriesRead(parts: FollowerWork, registries: readonly string[]): Effect.Effect<void> {
  return registries.length === 0 ? Effect.void : parts.discovery.registriesAppended(registries);
}

function registryRead(parts: FollowerWork, registry: string): Effect.Effect<void> {
  return parts.discovery.registriesAppended([registry]).pipe(
    Effect.andThen(
      Effect.sync(() => {
        parts.sweeps.registriesRead([registry]);
      }),
    ),
    Effect.catchCause((cause) =>
      parts.trouble('A registry of playbooks could not be read; the next sweep reads it again', cause),
    ),
  );
}

function signalled(parts: FollowerWork, wakes: Wakes) {
  return Effect.gen(function* () {
    yield* registriesRead(parts, wakes.registriesWoken());
    yield* Effect.forEach(
      wakes.playbooksWoken(),
      (playbookKey) => passedOnce(parts, wakes, { playbookKey, mode: 'signal', known: undefined }),
      { discard: true },
    );
  });
}

function swept(parts: FollowerWork, wakes: Wakes): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const sweep = yield* parts.sweeps.next();
    const handedBack = Effect.sync(() => {
      for (const { playbookKey } of sweep.playbooks) {
        parts.sweeps.passAgain(playbookKey);
      }
    });
    yield* Effect.forEach(sweep.registries, (registry) => registryRead(parts, registry), { discard: true });
    yield* parts.upkeep.sweep().pipe(Effect.catchCause((cause) => Effect.andThen(handedBack, Effect.failCause(cause))));
    yield* Effect.forEach(
      sweep.playbooks,
      ({ playbookKey, known }) => passedOnce(parts, wakes, { playbookKey, mode: 'sweep', known }),
      { discard: true },
    );
    return sweep.again;
  });
}

function roundOf(parts: FollowerWork, wakes: Wakes, sweep: boolean): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    yield* parts.upkeep.fireSchedules();
    yield* signalled(parts, wakes);
    return sweep ? yield* swept(parts, wakes) : false;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(parts.trouble('The follower of the playbooks failed; it tries again', cause), false),
    ),
  );
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

function nextWakeOf(parts: FollowerWork, wakes: Wakes, sweepOwed: boolean, now: number): Effect.Effect<NextWake> {
  if (wakes.anyWoken() || sweepOwed) {
    return Effect.succeed({ nextDueAt: now });
  }
  return Effect.map(nextScheduleOf(parts), (nextDueAt) => ({ nextDueAt }));
}

export function followerWakeUpOf(parts: FollowerWork, signal: WakeSignal): HostWakeUp {
  const wakes = wakesOf();
  const state = { started: false, tried: false, sweepOwed: false };
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
          state.sweepOwed = started;
        });
  return {
    wakeUp: oneWakeAtATime(({ now, sweep }) =>
      startedNow(sweep).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            state.started
              ? Effect.map(Effect.uninterruptible(roundOf(parts, wakes, sweep || state.sweepOwed)), (owed) => {
                  state.sweepOwed = owed;
                })
              : Effect.void,
          ),
        ),
        Effect.andThen(
          Effect.sync(() => {
            signal.renewed();
          }),
        ),
        Effect.andThen(() =>
          state.started ? nextWakeOf(parts, wakes, state.sweepOwed, now) : Effect.succeed({ nextDueAt: null }),
        ),
      ),
    ),
    stop: () =>
      Effect.sync(() => {
        stopListening();
      }),
  };
}
