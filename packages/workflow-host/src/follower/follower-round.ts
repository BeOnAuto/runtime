import { Effect, type Cause } from 'effect';

import { failedTryRetryMs, type HeldTries } from '../holds/playbook-holds.ts';
import { earliestOf, type FailedRounds } from '../loop/failed-rounds.ts';
import type { WakeUpParts, Woken } from '../loop/host-wake-up.ts';
import type { PlaybookSweeps } from '../sweeps/playbook-sweeps.ts';
import type { Wakes } from '../sweeps/wakes.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedPlaybook, HeldPlaybooks } from './followed-playbooks.ts';
import type { Discovery } from './playbook-discovery.ts';
import type { PassEnd } from './record-steps.ts';

export interface RoundUpkeep {
  readonly sweep: () => Effect.Effect<void>;
  readonly fireSchedules: () => Effect.Effect<void>;
}

export interface RoundParts extends Pick<WakeUpParts, 'clock' | 'trouble'> {
  readonly pass: (playbookKey: string, mode: Mode, known?: FollowedPlaybook) => Effect.Effect<PassEnd>;
  readonly discovery: Discovery;
  readonly sweeps: PlaybookSweeps;
  readonly upkeep: RoundUpkeep;
  readonly holds: HeldTries;
  readonly rounds: FailedRounds;
}

interface RoundThrough {
  readonly owed: boolean;
  readonly heldUntil: number | null;
  readonly failed: false;
}

interface RoundFailed {
  readonly owed: false;
  readonly heldUntil: number;
  readonly failed: true;
}

export type Round = RoundThrough | RoundFailed;

interface Passing {
  readonly playbookKey: string;
  readonly mode: Mode;
  readonly known: FollowedPlaybook | undefined;
}

function passedOnce(parts: RoundParts, wakes: Wakes, { playbookKey, mode, known }: Passing): Effect.Effect<boolean> {
  const seen = known === undefined ? parts.discovery.playbookSeen(playbookKey) : Effect.void;
  return Effect.andThen(seen, () => parts.pass(playbookKey, mode, known)).pipe(
    Effect.tap((end) =>
      Effect.sync(() => {
        if (end === 'more') {
          wakes.playbookAgain(playbookKey);
        }
      }),
    ),
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.andThen(
        parts.trouble('A pass over a playbook failed; the next sweep passes the playbook again', cause),
        Effect.sync(() => {
          parts.sweeps.passAgain(playbookKey);
          return false;
        }),
      ),
    ),
  );
}

function registriesRead(parts: RoundParts, registries: readonly string[]): Effect.Effect<void> {
  return registries.length === 0 ? Effect.void : parts.discovery.registriesAppended(registries);
}

function registryRead(parts: RoundParts, registry: string): Effect.Effect<void> {
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

function signalled(parts: RoundParts, wakes: Wakes) {
  return Effect.gen(function* () {
    yield* registriesRead(parts, wakes.registriesWoken());
    yield* Effect.forEach(
      wakes.playbooksWoken(),
      (playbookKey) => passedOnce(parts, wakes, { playbookKey, mode: 'signal', known: undefined }),
      { discard: true },
    );
  });
}

function swept(parts: RoundParts, wakes: Wakes): Effect.Effect<boolean> {
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

const heldPlaybooksInARound = 64;

interface TriedPass {
  readonly playbookKey: string;
  readonly through: boolean;
}

function failedOf(tries: readonly TriedPass[]): ReadonlySet<string> {
  return new Set(tries.filter((tried: TriedPass) => !tried.through).map((tried: TriedPass) => tried.playbookKey));
}

function failedPassesOf(parts: RoundParts, wakes: Wakes, held: HeldPlaybooks): Effect.Effect<ReadonlySet<string>> {
  const tried = Effect.forEach(held.due, (known) =>
    Effect.map(
      passedOnce(parts, wakes, { playbookKey: known.playbookKey, mode: 'sweep', known }),
      (through): TriedPass => ({ playbookKey: known.playbookKey, through }),
    ),
  );
  return Effect.map(tried, failedOf);
}

function heldPassed(parts: RoundParts, wakes: Wakes): Effect.Effect<number | null> {
  return Effect.gen(function* () {
    const held = yield* parts.holds.heldAt(parts.clock.now(), heldPlaybooksInARound);
    if (held.due.length === 0) {
      return held.nextAt;
    }
    const failedPasses = yield* failedPassesOf(parts, wakes, held);
    const now = parts.clock.now();
    const after = yield* parts.holds.heldAt(now, heldPlaybooksInARound);
    return yield* retriedAfter(parts, { failedPasses, after, now });
  });
}

interface Tries {
  readonly failedPasses: ReadonlySet<string>;
  readonly after: HeldPlaybooks;
  readonly now: number;
}

function retriedAfter(parts: RoundParts, { failedPasses, after, now }: Tries): Effect.Effect<number | null> {
  const failed = after.due.filter(({ playbookKey }) => failedPasses.has(playbookKey));
  const retryAt = now + failedTryRetryMs;
  const moreDue = failed.length < after.due.length || after.due.length >= heldPlaybooksInARound;
  return Effect.as(
    Effect.forEach(failed, (held) => parts.holds.failed(held, { at: now, retryAt }), { discard: true }),
    moreDue ? now : earliestOf(after.nextAt, failed.length === 0 ? null : retryAt),
  );
}

export function failedAt(
  { rounds, trouble }: Pick<RoundParts, 'rounds' | 'trouble'>,
  now: number,
  what: string,
): (cause: Cause.Cause<unknown>) => Effect.Effect<Round> {
  return (cause) =>
    Effect.flatMap(rounds.failed(), (retryAfterMs) =>
      Effect.as(trouble(what, cause), { owed: false, heldUntil: now + retryAfterMs, failed: true }),
    );
}

export function roundOf(parts: RoundParts, wakes: Wakes, { now, sweep }: Woken): Effect.Effect<Round> {
  return Effect.gen(function* () {
    yield* parts.upkeep.fireSchedules();
    yield* signalled(parts, wakes);
    const owed = sweep ? yield* swept(parts, wakes) : false;
    const heldUntil = yield* heldPassed(parts, wakes);
    yield* parts.rounds.succeeded();
    const through: Round = { owed, heldUntil, failed: false };
    return through;
  }).pipe(
    Effect.catchCause(
      failedAt(
        parts,
        now,
        'The follower of the playbooks failed; it tries again in a minute, twice as long after each round that fails in a row, at most an hour',
      ),
    ),
  );
}
