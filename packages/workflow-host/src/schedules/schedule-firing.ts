import { triggerNamed } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import type { ReactionStart, StartReaction } from '../reactions/reaction-options.ts';
import type { Refusals } from '../reactions/refusals.ts';
import { dueSchedules, nextScheduleDue, scheduleMovedOn, type Schedule } from './schedule-rows.ts';
import { latestDue, nextAfter } from './schedule-times.ts';

export interface ScheduleFiring {
  readonly fireDue: () => Effect.Effect<number>;
  readonly nextDueAt: () => Effect.Effect<number | null>;
}

interface FiringParts {
  readonly database: HostDatabase;
  readonly start: StartReaction;
  readonly refusals: Refusals;
  readonly now: () => number;
}

interface Firing {
  readonly subscription: Schedule;
  readonly next: number | null;
  readonly latest: number;
}

const schedulesInOneFiring = 64;

const EndedRow = Schema.Struct({ ended_at: Schema.NullOr(WholeNumber) });

function playbookOf(playbookKey: string): { readonly org: string; readonly playbook: string } {
  const [, org = '', playbook = ''] = playbookKey.split('/');
  return { org, playbook };
}

function dueAtOf({ latest }: Firing): string {
  return new Date(latest).toISOString();
}

function namedOf({ subscription }: Firing): string {
  return triggerNamed(subscription.trigger.kind);
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
      subscription,
      `The run its ${namedOf(firing)} had due at ${dueAtOf(firing)} was skipped: the run its ${namedOf(firing)} started before still runs`,
    ),
    scheduleMovedOn(database, subscription, next, subscription.running),
  );
}

function missedSaid({ refusals }: FiringParts, firing: Firing) {
  const { subscription, latest } = firing;
  return latest > subscription.nextDue
    ? refusals.refuse(
        subscription.playbookKey,
        subscription,
        `The runs its ${namedOf(firing)} had due from ${new Date(subscription.nextDue).toISOString()} to ${dueAtOf(firing)} came while the server was down, and only the latest ran`,
      )
    : Effect.void;
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

function ran(parts: FiringParts, firing: Firing) {
  const { playbookKey } = firing.subscription;
  const start = startOf(firing);
  return parts.start(start).pipe(
    Effect.andThen(
      Effect.andThen(
        scheduleMovedOn(parts.database, firing.subscription, firing.next, start.runId),
        missedSaid(parts, firing),
      ),
    ),
    Effect.catch(({ detail }: Readonly<{ detail: string }>) =>
      Effect.andThen(
        parts.refusals.refuse(
          playbookKey,
          firing.subscription,
          `The run its ${namedOf(firing)} had due at ${dueAtOf(firing)} could not be started: ${detail}`,
        ),
        scheduleMovedOn(parts.database, firing.subscription, firing.next, null),
      ),
    ),
  );
}

function fired(parts: FiringParts, subscription: Schedule) {
  const at = parts.now();
  const { trigger, activatedAt, nextDue } = subscription;
  const firing: Firing = {
    subscription,
    next: nextAfter(trigger, activatedAt, at),
    latest: latestDue(trigger, activatedAt, nextDue, at),
  };
  return Effect.flatMap(stillRuns(parts.database, subscription.playbookKey, subscription.running), (runs) =>
    runs ? skipped(parts, firing) : ran(parts, firing),
  );
}

export function scheduleFiringOn(
  database: HostDatabase,
  start: StartReaction,
  refusals: Refusals,
  now: () => number,
): ScheduleFiring {
  const parts: FiringParts = { database, start, refusals, now };
  return {
    fireDue: () =>
      Effect.gen(function* () {
        const due = yield* dueSchedules(database, now(), schedulesInOneFiring);
        yield* Effect.forEach(due, (subscription) => fired(parts, subscription), { discard: true });
        return due.length;
      }),
    nextDueAt: () => nextScheduleDue(database),
  };
}
