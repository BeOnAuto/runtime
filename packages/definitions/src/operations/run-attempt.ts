import {
  IncompleteDetailsSchema,
  type CancelledKind,
  type ConflictKind,
  type InvalidInputKind,
  type RejectionBecause,
  type UnavailableKind,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { CapabilityAnswer, CapabilityRejection } from '../capability/capability.ts';
import { withinResultLimit } from '../runs/recorded-size.ts';
import type { RunOutcome, RunResult, InterruptedAttempt } from '../runs/run-commands.ts';
import { runTaken } from '../runs/run-decisions.ts';
import { AnsweredRecordSchema } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import { issuesUnder, type Rejection } from './issue-pointers.ts';

const ExecutedSchema = Schema.Union([
  Schema.Struct({
    output: Schema.Json,
    record: AnsweredRecordSchema,
    incomplete_details: Schema.optionalKey(IncompleteDetailsSchema),
  }),
  Schema.Struct({ finishesLater: Schema.Literal(true), record: Schema.JsonObject }),
]);

type Executed = typeof ExecutedSchema.Type;

type Answered = Exclude<Executed, { readonly finishesLater: true }>;

const decodeExecuted = Schema.decodeUnknownEffect(ExecutedSchema);

export const failedAttempt: RunResult = { type: 'run_failed', data: {} };

export function interruptedAttempt(resumesAfterMs: number): InterruptedAttempt {
  return Number.isFinite(resumesAfterMs) ? { type: 'run_interrupted', resumes: true } : { type: 'run_interrupted' };
}

function succeededWith({ output, record, incomplete_details: incomplete }: Answered): RunOutcome {
  return {
    type: 'run_succeeded',
    data: { output, record, ...(incomplete === undefined ? {} : { incomplete_details: incomplete }) },
  };
}

function recordedOutcome(ran: Executed): Effect.Effect<RunOutcome> {
  return 'finishesLater' in ran
    ? withinResultLimit(ran.record).pipe(
        Effect.map((): RunOutcome => ({ type: 'run_deferred', data: { record: ran.record } })),
      )
    : withinResultLimit(ran.output, ran.record).pipe(Effect.map((): RunOutcome => succeededWith(ran)));
}

function outcomeOf(ran: CapabilityAnswer): Effect.Effect<RunOutcome> {
  return decodeExecuted(ran).pipe(Effect.orDie, Effect.flatMap(recordedOutcome));
}

const decodeRecord = Schema.decodeUnknownEffect(Schema.JsonObject);

interface Recorded {
  readonly record?: Schema.JsonObject;
}

function rejectedWith(rejection: RunRejection, { record }: Recorded): Effect.Effect<RunResult> {
  if (record === undefined) {
    return Effect.succeed({ type: 'run_rejected', data: { rejection } });
  }
  return decodeRecord(record).pipe(
    Effect.orDie,
    Effect.tap((checked) => withinResultLimit(checked)),
    Effect.map((checked): RunResult => ({ type: 'run_rejected', data: { rejection, record: checked } })),
  );
}

function rejectedForInput(
  rejection: Rejection & Recorded & { readonly kind?: InvalidInputKind },
): Effect.Effect<RunResult> {
  const { detail, issues, kind } = rejection;
  return rejectedWith(
    { reason: 'invalid_input', detail, issues: issuesUnder('input', issues), ...(kind === undefined ? {} : { kind }) },
    rejection,
  );
}

interface Unavailability extends Recorded {
  readonly detail: string;
  readonly kind?: UnavailableKind;
  readonly because?: RejectionBecause;
}

function rejectedAsUnavailable(rejection: Unavailability): Effect.Effect<RunResult> {
  const { detail, kind, because } = rejection;
  return rejectedWith(
    {
      reason: 'unavailable',
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    },
    rejection,
  );
}

interface Clash extends Recorded {
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly because?: RejectionBecause;
}

function rejectedAsConflict(rejection: Clash): Effect.Effect<RunResult> {
  const { detail, kind, because } = rejection;
  return rejectedWith(
    {
      reason: 'conflict',
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    },
    rejection,
  );
}

interface Cancel extends Recorded {
  readonly detail: string;
  readonly kind: CancelledKind;
}

function rejectedAsCancelled(rejection: Cancel): Effect.Effect<RunResult> {
  const { detail, kind } = rejection;
  return rejectedWith({ reason: 'cancelled', detail, kind }, rejection);
}

export function attempt(running: Effect.Effect<CapabilityAnswer, CapabilityRejection>): Effect.Effect<RunOutcome> {
  return running.pipe(
    Effect.flatMap(outcomeOf),
    Effect.catchTags({
      invalid_input: rejectedForInput,
      unavailable: rejectedAsUnavailable,
      conflict: rejectedAsConflict,
      cancelled: rejectedAsCancelled,
    }),
  );
}

export function isTakenByAnother(outcome: RunOutcome): boolean {
  return (
    outcome.type === 'run_rejected' &&
    outcome.data.rejection.reason === 'conflict' &&
    outcome.data.rejection.kind === runTaken.kind
  );
}
