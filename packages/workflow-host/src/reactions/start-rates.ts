import { triggerNamed } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { StartingTriggerSchema } from '@on.auto/operations';
import { Effect, Schema, type Tracer } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { DeliveryFailed, deliverySweeps } from '../follower/consumers.ts';
import { linksTo } from '../runs/run-spans.ts';
import type { ReactionStart, StartReaction } from './reaction-options.ts';
import type { Refusals } from './refusals.ts';

export const mostStartsAMinute = 60;

export const mostDeferredStarts = 1000;

const aMinute = 60_000;

function unstarted({ trigger }: ReactionStart, detail: string): string {
  return `The workflow could not be started by its ${triggerNamed(trigger.kind)}: ${detail}`;
}

export interface Starting {
  readonly start: (playbookKey: string, start: ReactionStart) => Effect.Effect<void, DeliveryFailed>;
  readonly startDeferred: () => Effect.Effect<number>;
}

interface StartingParts {
  readonly database: HostDatabase;
  readonly startReaction: StartReaction;
  readonly refusals: Refusals;
}

const ReactionStartSchema = Schema.Struct({
  org: Schema.String,
  playbook: Schema.String,
  workflow: Schema.String,
  version: Schema.Int,
  runId: Schema.String,
  input: Schema.Json,
  depth: Schema.Int,
  cause: Schema.String,
  trigger: StartingTriggerSchema,
  trace: Schema.optionalKey(Schema.Struct({ traceId: Schema.String, spanId: Schema.String })),
});

const DeferredRow = Schema.Struct({
  playbook_key: Schema.String,
  start: Schema.fromJsonString(ReactionStartSchema),
  attempts: WholeNumber,
});

type Deferred = typeof DeferredRow.Type;

const CountRow = Schema.Struct({ deferred: WholeNumber });

function minuteOf(at: number): number {
  return Math.floor(at / aMinute) * aMinute;
}

function admitted(database: HostDatabase, playbookKey: string, workflow: string, minute: number) {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_rates (playbook_key, workflow, minute, starts)
        VALUES (${playbookKey}, ${workflow}, ${minute}, 1)
        ON CONFLICT (playbook_key, workflow) DO UPDATE SET
          starts = CASE WHEN workflow_reaction_rates.minute = excluded.minute
            THEN workflow_reaction_rates.starts + 1 ELSE 1 END,
          minute = excluded.minute
        WHERE workflow_reaction_rates.minute <> excluded.minute OR workflow_reaction_rates.starts < ${mostStartsAMinute}
        RETURNING starts`,
    ),
  ).pipe(Effect.map((rows) => rows.length > 0));
}

function deferredOf(database: HostDatabase, playbookKey: string, workflow: string) {
  return Effect.orDie(
    rowsOf(
      CountRow,
      database.read(
        statement`SELECT count(*) AS deferred FROM workflow_reaction_backlog
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.reduce((sum, { deferred }) => sum + deferred, 0)));
}

function started(
  { startReaction, refusals }: StartingParts,
  playbookKey: string,
  start: ReactionStart,
): Effect.Effect<void, DeliveryFailed> {
  return startReaction(start).pipe(
    Effect.catchTag('start_rejected', ({ detail }: Readonly<{ detail: string }>) =>
      refusals.refuse(playbookKey, start, unstarted(start, detail)),
    ),
    Effect.mapError(({ detail }: Readonly<{ detail: string }>) => new DeliveryFailed({ detail })),
  );
}

function deferredStart(
  { database, refusals }: StartingParts,
  playbookKey: string,
  start: ReactionStart,
  minute: number,
) {
  return Effect.flatMap(deferredOf(database, playbookKey, start.workflow), (deferred) =>
    deferred >= mostDeferredStarts
      ? refusals.refuse(
          playbookKey,
          start,
          `The workflow was started by its ${triggerNamed(start.trigger.kind)} ${mostStartsAMinute} times a minute and ${mostDeferredStarts} starts already waited for a later minute, the most it keeps; this start was refused`,
        )
      : Effect.asVoid(
          Effect.orDie(
            database.write(
              statement`INSERT INTO workflow_reaction_backlog (playbook_key, workflow, run_id, start, due)
                VALUES (${playbookKey}, ${start.workflow}, ${start.runId}, ${JSON.stringify(start)}, ${minute + aMinute})
                ON CONFLICT (playbook_key, run_id) DO NOTHING`,
            ),
          ),
        ),
  );
}

function withoutDeferred(database: HostDatabase, { playbook_key: playbookKey, start }: Deferred) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_reaction_backlog
          WHERE playbook_key = ${playbookKey} AND run_id = ${start.runId}`,
      ),
    ),
  );
}

function deferredAgain({ database }: StartingParts, deferred: Deferred, minute: number, attempts: number) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_reaction_backlog SET due = ${minute + aMinute}, attempts = ${attempts}
          WHERE playbook_key = ${deferred.playbook_key} AND run_id = ${deferred.start.runId}`,
      ),
    ),
  );
}

function failedWhenDue(parts: StartingParts, deferred: Deferred, minute: number, detail: string) {
  const attempts = deferred.attempts + 1;
  return attempts < deliverySweeps
    ? deferredAgain(parts, deferred, minute, attempts)
    : Effect.andThen(
        parts.refusals.refuse(deferred.playbook_key, deferred.start, unstarted(deferred.start, detail)),
        withoutDeferred(parts.database, deferred),
      );
}

function deferredSpanOf({ org, playbook, runId, workflow, trigger, trace }: ReactionStart): Tracer.SpanOptions {
  return {
    attributes: {
      'auto.on.org': org,
      'auto.on.playbook': playbook,
      'auto.on.run_id': runId,
      'auto.on.workflow': workflow,
      'auto.on.trigger.kind': trigger.kind,
    },
    links: linksTo(trace),
  };
}

function startedWhenDue(parts: StartingParts, deferred: Deferred, minute: number) {
  const { playbook_key: playbookKey, start } = deferred;
  return Effect.flatMap(admitted(parts.database, playbookKey, start.workflow, minute), (admits) =>
    admits
      ? started(parts, playbookKey, start).pipe(
          Effect.withSpan('deferred_start', deferredSpanOf(start)),
          Effect.andThen(withoutDeferred(parts.database, deferred)),
          Effect.catch(({ detail }: Readonly<{ detail: string }>) => failedWhenDue(parts, deferred, minute, detail)),
        )
      : deferredAgain(parts, deferred, minute, deferred.attempts),
  );
}

export function startingOn(
  database: HostDatabase,
  startReaction: StartReaction,
  refusals: Refusals,
  now: () => number,
): Starting {
  const parts: StartingParts = { database, startReaction, refusals };
  return {
    start: (playbookKey, start) => {
      const minute = minuteOf(now());
      return Effect.flatMap(admitted(database, playbookKey, start.workflow, minute), (admits) =>
        admits ? started(parts, playbookKey, start) : deferredStart(parts, playbookKey, start, minute),
      );
    },
    startDeferred: () =>
      Effect.gen(function* () {
        const minute = minuteOf(now());
        const due = yield* Effect.orDie(
          rowsOf(
            DeferredRow,
            database.read(
              statement`SELECT playbook_key, start, attempts FROM workflow_reaction_backlog WHERE due <= ${now()}
                ORDER BY due, run_id LIMIT ${mostStartsAMinute}`,
            ),
          ),
        );
        yield* Effect.forEach(due, (deferred) => startedWhenDue(parts, deferred, minute), { discard: true });
        return due.length;
      }),
  };
}
