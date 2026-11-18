import { Effect, type Cause } from 'effect';

import { failedTryRetryMs, type HeldTries } from '../holds/playbook-holds.ts';
import { earliestOf, type FailedRounds } from '../loop/failed-rounds.ts';
import type { WakeUpParts, Woken } from '../loop/host-wake-up.ts';
import type { OrgSweeps } from '../sweeps/org-sweeps.ts';
import type { Wakes } from '../sweeps/wakes.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedOrg, HeldPlaybook, HeldPlaybooks } from './followed-orgs.ts';
import type { Discovery } from './org-discovery.ts';
import type { Passes } from './org-pass.ts';

export interface RoundUpkeep {
  readonly sweep: () => Effect.Effect<void>;
  readonly fireSchedules: () => Effect.Effect<void>;
}

export interface RoundParts extends Pick<WakeUpParts, 'clock' | 'trouble'> {
  readonly passes: Passes;
  readonly discovery: Discovery;
  readonly sweeps: OrgSweeps;
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

const parkedInASweep = 64;

interface Passing {
  readonly org: string;
  readonly mode: Mode;
  readonly known: FollowedOrg | undefined;
}

function passedOnce(parts: RoundParts, wakes: Wakes, { org, mode, known }: Passing): Effect.Effect<void> {
  const seen = known === undefined ? parts.discovery.orgSeen(org) : Effect.void;
  return Effect.andThen(seen, () => parts.passes.org(org, mode, known)).pipe(
    Effect.tap((end) =>
      Effect.sync(() => {
        if (end === 'more') {
          wakes.orgAgain(org);
        }
      }),
    ),
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Effect.andThen(
        parts.trouble("A pass over an org's records failed; the next sweep passes the org again", cause),
        Effect.sync(() => {
          parts.sweeps.passAgain(org);
        }),
      ),
    ),
  );
}

function signalled(parts: RoundParts, wakes: Wakes) {
  return Effect.forEach(
    wakes.orgsWoken(),
    (org) => passedOnce(parts, wakes, { org, mode: 'signal', known: undefined }),
    { discard: true },
  );
}

function heldOnce(parts: RoundParts, held: HeldPlaybook): Effect.Effect<boolean> {
  return parts.passes.held(held).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.as(
        parts.trouble('A pass over a held playbook failed; the next try passes the playbook again', cause),
        false,
      ),
    ),
  );
}

function swept(parts: RoundParts, wakes: Wakes): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const sweep = yield* parts.sweeps.next();
    const handedBack = Effect.sync(() => {
      for (const { org } of sweep.orgs) {
        parts.sweeps.passAgain(org);
      }
    });
    yield* parts.upkeep.sweep().pipe(Effect.catchCause((cause) => Effect.andThen(handedBack, Effect.failCause(cause))));
    yield* Effect.forEach(sweep.orgs, ({ org, known }) => passedOnce(parts, wakes, { org, mode: 'sweep', known }), {
      discard: true,
    });
    const parked = yield* parts.holds.parkedForDelivery(parkedInASweep);
    yield* Effect.forEach(parked, (held) => heldOnce(parts, held), { discard: true });
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

function failedPassesOf(parts: RoundParts, held: HeldPlaybooks): Effect.Effect<ReadonlySet<string>> {
  const tried = Effect.forEach(held.due, (known) =>
    Effect.map(heldOnce(parts, known), (through): TriedPass => ({ playbookKey: known.playbookKey, through })),
  );
  return Effect.map(tried, failedOf);
}

function heldPassed(parts: RoundParts): Effect.Effect<number | null> {
  return Effect.gen(function* () {
    const held = yield* parts.holds.heldAt(parts.clock.now(), heldPlaybooksInARound);
    if (held.due.length === 0) {
      return held.nextAt;
    }
    const failedPasses = yield* failedPassesOf(parts, held);
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
    const heldUntil = yield* heldPassed(parts);
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
