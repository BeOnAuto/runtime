import type { ConflictKind, InvalidInputKind, RejectionBecause, UnavailableKind } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { CapabilityAnswer, CapabilityRejection } from '../capability/capability.ts';
import { withinResultLimit } from '../runs/recorded-size.ts';
import type { RunOutcome, RunResult, InterruptedAttempt } from '../runs/run-commands.ts';
import type { RunRejection } from '../runs/run.ts';
import { issuesUnder, type Rejection } from './issue-pointers.ts';

const decodeExecuted = Schema.decodeUnknownEffect(
  Schema.Union([
    Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }),
    Schema.Struct({ finishesLater: Schema.Literal(true), record: Schema.JsonObject }),
  ]),
);

export const failedAttempt: RunResult = { type: 'run_failed', data: {} };

export const interruptedAttempt: InterruptedAttempt = { type: 'run_interrupted' };

function recordedOutcome(ran: CapabilityAnswer): Effect.Effect<RunOutcome> {
  return 'finishesLater' in ran
    ? withinResultLimit(ran.record).pipe(
        Effect.map((): RunOutcome => ({ type: 'run_deferred', data: { record: ran.record } })),
      )
    : withinResultLimit(ran.output, ran.record).pipe(
        Effect.map((): RunOutcome => ({ type: 'run_succeeded', data: { output: ran.output, record: ran.record } })),
      );
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

export function attempt(running: Effect.Effect<CapabilityAnswer, CapabilityRejection>): Effect.Effect<RunOutcome> {
  return running.pipe(
    Effect.flatMap(outcomeOf),
    Effect.catchTags({
      invalid_input: rejectedForInput,
      unavailable: rejectedAsUnavailable,
      conflict: rejectedAsConflict,
    }),
  );
}
