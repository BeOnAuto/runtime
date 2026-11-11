import { scheduleNamed } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Effect, Result, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import type { ReactionStart, StartReaction } from '../reactions/reaction-options.ts';
import {
  codesOf,
  type FailureDetail,
  type Refusal,
  type Refusals,
  type RejectionCodes,
} from '../reactions/refusals.ts';
import { dueSchedules, nextScheduleDue, scheduleHeld, scheduleMovedOn, type Schedule } from './schedule-rows.ts';
import { dueTimesOf } from './schedule-times.ts';

export interface ScheduleFiring {
  readonly fireDue: () => Effect.Effect<number>;
  readonly nextDueAt: () => Effect.Effect<number | null>;
}

export interface FiringParts extends Pick<FollowerHost, 'database' | 'reports'> {
  readonly clock: Required<Pick<FollowerHost['clock'], 'now' | 'inZone'>>;
  readonly start: StartReaction;
  readonly refusals: Refusals;
}

interface Firing {
  readonly subscription: Schedule;
  readonly next: number | null;
  readonly latest: number;
}

interface Plan {
  readonly firing: Firing;
  readonly heldSkipped: number | null;
}

const schedulesInOneFiring = 64;

const aMinute = 60_000;

const EndedRow = Schema.Struct({ ended_at: Schema.NullOr(WholeNumber) });

function playbookOf(playbookKey: string): { readonly org: string; readonly playbook: string } {
  const [, org = '', playbook = ''] = playbookKey.split('/');
  return { org, playbook };
}

function isoOf(at: number): string {
  return new Date(at).toISOString();
}

function dueAtOf({ latest }: Firing): string {
  return isoOf(latest);
}

function namedOf({ subscription }: Firing): string {
  return scheduleNamed(subscription.trigger);
}

function refusalOf({ workflow, version, trigger }: Schedule, reason: string, codes: RejectionCodes = {}): Refusal {
  return {
    workflow,
    version,
    trigger: { kind: trigger.kind, reference: trigger.reference },
    reason,
    ...codesOf(codes),
  };
}

function stillRuns(database: HostDatabase, playbookKey: string, running: string | null): Effect.Effect<boolean> {
  if (running === null) {
    return Effect.succeed(false);
  }
  const { org, playbook } = playbookOf(playbookKey);
  return Effect.orDie(
    rowsOf(
      EndedRow,
      database.read(statement`SELECT ended_at FROM workflow_runs WHERE run_key = ${`${org}/${playbook}/${running}`}`),
    ),
  ).pipe(Effect.map(([row]) => row !== undefined && row.ended_at === null));
}

function skipped({ database, refusals }: FiringParts, firing: Firing) {
  const { subscription, next } = firing;
  return Effect.andThen(
    refusals.refuse(
      subscription.playbookKey,
      refusalOf(
        subscription,
        `The run its ${namedOf(firing)} had due at ${dueAtOf(firing)} was skipped: the run its ${namedOf(firing)} started before still runs`,
      ),
    ),
    scheduleMovedOn(database, subscription, next, subscription.running),
  );
}

function missedSaid({ refusals }: FiringParts, firing: Firing) {
  const { subscription, latest } = firing;
  return latest > subscription.nextDue
    ? refusals.refuse(
        subscription.playbookKey,
        refusalOf(
          subscription,
          `The runs its ${namedOf(firing)} had due from ${isoOf(subscription.nextDue)} to ${dueAtOf(firing)} came while the server was down, and only the latest ran`,
        ),
      )
    : Effect.void;
}

function heldTimeSkipped({ refusals }: FiringParts, firing: Firing, heldDue: number) {
  const { subscription } = firing;
  return refusals.refuse(
    subscription.playbookKey,
    refusalOf(
      subscription,
      `The run scheduled for ${isoOf(heldDue)} by its ${namedOf(firing)} was skipped: the workflow could not be read from storage before the next scheduled run, at ${isoOf(subscription.nextDue)}`,
      { kind: 'content_unavailable' },
    ),
  );
}

function startOf(firing: Firing): ReactionStart {
  const { playbookKey, workflow, version, trigger, activatedBy } = firing.subscription;
  const due = dueAtOf(firing);
  return {
    ...playbookOf(playbookKey),
    workflow,
    version,
    runId: reactionRunIdOf(workflow, version, trigger.reference, due),
    input: { schedule: { due } },
    depth: 1,
    cause: activatedBy,
    trigger: { kind: trigger.kind, reference: trigger.reference },
  };
}

function held(parts: FiringParts, firing: Firing) {
  const { subscription, latest, next } = firing;
  const triedAgainAt = Math.min(parts.clock.now() + aMinute, ...[next].filter((due) => due !== null));
  return Effect.andThen(scheduleHeld(parts.database, subscription, latest, triedAgainAt), missedSaid(parts, firing));
}

function refused(parts: FiringParts, firing: Firing, failure: FailureDetail) {
  return Effect.andThen(
    parts.refusals.refuse(
      firing.subscription.playbookKey,
      refusalOf(
        firing.subscription,
        `The run its ${namedOf(firing)} had due at ${dueAtOf(firing)} could not be started: ${failure.detail}`,
        failure,
      ),
    ),
    scheduleMovedOn(parts.database, firing.subscription, firing.next, null),
  );
}

function ran(parts: FiringParts, firing: Firing) {
  const start = startOf(firing);
  return parts.start(start).pipe(
    Effect.andThen(
      Effect.andThen(
        scheduleMovedOn(parts.database, firing.subscription, firing.next, start.runId),
        missedSaid(parts, firing),
      ),
    ),
    Effect.catch((failure: FailureDetail) =>
      failure.kind === 'content_unavailable' ? held(parts, firing) : refused(parts, firing, failure),
    ),
  );
}

function stopped(parts: FiringParts, subscription: Schedule, detail: string) {
  const { playbookKey, workflow, version, trigger, running } = subscription;
  return Effect.andThen(
    Effect.andThen(
      parts.refusals.refuse(
        playbookKey,
        refusalOf(
          subscription,
          `The times of its ${scheduleNamed(trigger)} cannot be computed, so it starts no more runs: ${detail}`,
        ),
      ),
      parts.reports.note({
        kind: 'schedule_stopped',
        ...playbookOf(playbookKey),
        workflow,
        version,
        reference: trigger.reference,
        detail,
      }),
    ),
    scheduleMovedOn(parts.database, subscription, null, running),
  );
}

function firingFrom(parts: FiringParts, subscription: Schedule, due: number): Result.Result<Firing, string> {
  const moments = { anchor: subscription.activatedAt, due, now: parts.clock.now() };
  return Result.map(dueTimesOf(subscription.trigger, moments, parts.clock.inZone), ({ latest, next }) => ({
    subscription,
    latest,
    next,
  }));
}

function heldPlanOf(parts: FiringParts, subscription: Schedule, heldDue: number): Result.Result<Plan, string> {
  const atTheHeldTime = { anchor: subscription.activatedAt, due: heldDue, now: heldDue };
  return Result.flatMap(
    dueTimesOf(subscription.trigger, atTheHeldTime, parts.clock.inZone),
    ({ next }): Result.Result<Plan, string> =>
      next !== null && next <= parts.clock.now()
        ? Result.map(firingFrom(parts, { ...subscription, heldDue: null, nextDue: next }, next), (firing) => ({
            firing,
            heldSkipped: heldDue,
          }))
        : Result.succeed({ firing: { subscription, latest: heldDue, next }, heldSkipped: null }),
  );
}

function planOf(parts: FiringParts, subscription: Schedule): Result.Result<Plan, string> {
  return subscription.heldDue === null
    ? Result.map(firingFrom(parts, subscription, subscription.nextDue), (firing) => ({ firing, heldSkipped: null }))
    : heldPlanOf(parts, subscription, subscription.heldDue);
}

function fired(parts: FiringParts, subscription: Schedule) {
  return Result.match(planOf(parts, subscription), {
    onFailure: (detail) => stopped(parts, subscription, detail),
    onSuccess: ({ firing, heldSkipped }) =>
      Effect.andThen(
        heldSkipped === null ? Effect.void : heldTimeSkipped(parts, firing, heldSkipped),
        Effect.flatMap(stillRuns(parts.database, subscription.playbookKey, subscription.running), (runs) =>
          runs ? skipped(parts, firing) : ran(parts, firing),
        ),
      ),
  });
}

export function scheduleFiringOn(parts: FiringParts): ScheduleFiring {
  const { database, clock } = parts;
  return {
    fireDue: () =>
      Effect.gen(function* () {
        const due = yield* dueSchedules(database, clock.now(), schedulesInOneFiring);
        yield* Effect.forEach(due, (subscription) => fired(parts, subscription), { discard: true });
        return due.length;
      }),
    nextDueAt: () => nextScheduleDue(database),
  };
}
