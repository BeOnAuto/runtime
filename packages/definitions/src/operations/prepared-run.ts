import {
  CallLineage,
  Caller,
  Conflict,
  PlaybookContext,
  recordedCallerOf,
  type GivenLineage,
  type RecordedCaller,
} from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import { admittedByTheMeter, type MeteredRun } from '../metering/run-meter.ts';
import { payloadWritten, type PayloadWritten } from '../payloads/payload-writing.ts';
import { firstAttempt, type RunRequest, type RunStart } from '../runs/run-commands.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import { answeredAttempt } from './attempt-endings.ts';
import { contextOf, type Called, type Prepared } from './run-contexts.ts';
import { startRecorded } from './start-recording.ts';

export const mostCallDepth = 8;

function tooDeep(callDepth: number): Conflict {
  return new Conflict({
    detail: `This run would sit ${callDepth} calls below the run at the top of its tree, more than the ${mostCallDepth} a run may: workflows that call workflows reach at most ${mostCallDepth} calls deep`,
  });
}

function outputShapeOf(prepared: PreparedDefinition, input: Schema.Json) {
  return prepared.answersItsShapeFor(input) ? shapeNameIn(prepared.summary.details) : undefined;
}

function startOf(
  request: RunRequest & Pick<RunStart, 'inputKept'>,
  { definition, prepared, createOnly }: Prepared,
  given: GivenLineage,
  startedBy: RecordedCaller,
) {
  const { depth, callDepth, calledBy, trigger, actsFor } = given;
  const shape = outputShapeOf(prepared, request.input);
  return {
    type: 'start' as const,
    ...request,
    started_by: startedBy,
    definition_version: definition.version,
    calls_tools: prepared.callsTools,
    finishes_later: prepared.finishesLaterFor(request.input),
    ...(shape === undefined ? {} : { output_shape: shape }),
    depth,
    call_depth: callDepth,
    ...(calledBy === null ? {} : { called_by: calledBy }),
    ...(trigger === null ? {} : { trigger }),
    ...(actsFor === null ? {} : { acts_for: actsFor }),
    ...(createOnly === true ? { createOnly } : {}),
    ...(Number.isFinite(prepared.resumesAfterMs) ? { resumes: true as const } : {}),
  };
}

interface StartOfARun {
  readonly id: string;
  readonly request: RunRequest;
  readonly run: Prepared;
  readonly given: GivenLineage;
  readonly correlationId: string;
  readonly startedBy: RecordedCaller;
}

function meteredRunOf({ id, request, run: { definition }, given, correlationId, startedBy }: StartOfARun) {
  return Effect.map(PlaybookContext, ({ org, playbook }): MeteredRun => ({
    org,
    playbook,
    run_id: id,
    definition_type: request.definition_type,
    definition_name: request.name,
    definition_version: definition.version,
    correlation_id: correlationId,
    called_by: given.calledBy?.run_id ?? null,
    trigger: given.trigger,
    started_by: startedBy.id,
  }));
}

function inputKeptIn(request: RunRequest, { payload }: PayloadWritten): RunRequest & Pick<RunStart, 'inputKept'> {
  return 'kept' in payload ? { ...request, inputKept: payload.kept } : request;
}

export const runPrepared = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  id: string,
  request: RunRequest,
  run: Prepared,
) {
  const given: Called = { ...(yield* CallLineage), capabilities };
  if (given.callDepth > mostCallDepth) {
    return yield* tooDeep(given.callDepth);
  }
  const correlationId = given.lineage?.correlationId ?? id;
  const startedBy = recordedCallerOf(yield* Caller);
  const written = inputKeptIn(request, yield* payloadWritten({ inline: request.input }));
  yield* admittedByTheMeter(yield* meteredRunOf({ id, request, run, given, correlationId, startedBy }));
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { messageId, startedAt, modelCallsBefore } = yield* startRecorded(
        id,
        startOf(written, run, given, startedBy),
        {
          causationId: given.lineage?.causationId ?? null,
          correlationId,
        },
      );
      const lineage = { startId: messageId, correlationId };
      const context = yield* contextOf(id, run, given, {
        lineage,
        attempt: { startedAt, modelCallsBefore, calls: [] },
      });
      return yield* answeredAttempt({ id, run, input: request.input, context, number: firstAttempt }, restore);
    }),
  );
});
