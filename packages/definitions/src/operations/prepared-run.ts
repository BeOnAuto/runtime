import {
  CallLineage,
  Caller,
  Conflict,
  PlaybookContext,
  recordedCallerOf,
  type GivenLineage,
  type PlaybookAddress,
  type RecordedCaller,
} from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import { admittedByTheMeter, type MeteredRun } from '../metering/run-meter.ts';
import { payloadWritten, type PayloadWritten } from '../payloads/payload-writing.ts';
import type { RunRequest, RunStart } from '../runs/run-commands.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import { answeredAttempt } from './attempt-endings.ts';
import { contextOf, type Called, type PreparedToStart } from './run-contexts.ts';
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
  { run: { definition, prepared, createOnly }, given, startedBy, place }: StartOfARun,
) {
  const { depth, callDepth, calledBy, trigger, actsFor } = given;
  const shape = outputShapeOf(prepared, request.input);
  return {
    type: 'start' as const,
    ...request,
    started_by: startedBy,
    playbook: place.playbook,
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
  readonly run: PreparedToStart;
  readonly given: GivenLineage;
  readonly correlationId: string;
  readonly startedBy: RecordedCaller;
  readonly place: PlaybookAddress;
}

function meteredRunOf({
  id,
  request,
  run: { definition },
  given,
  correlationId,
  startedBy,
  place,
}: StartOfARun): MeteredRun {
  return {
    org: place.org,
    playbook: place.playbook,
    run_id: id,
    definition_id: definition.definition_id,
    definition_type: request.definition_type,
    definition_name: request.name,
    definition_version: definition.version,
    correlation_id: correlationId,
    called_by: given.calledBy?.run_id ?? null,
    trigger: given.trigger,
    started_by: startedBy.id,
  };
}

function inputKeptIn(request: RunRequest, { payload }: PayloadWritten): RunRequest & Pick<RunStart, 'inputKept'> {
  return 'kept' in payload ? { ...request, inputKept: payload.kept } : request;
}

export const runPrepared = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  id: string,
  request: RunRequest,
  run: PreparedToStart,
) {
  const given: Called = { ...(yield* CallLineage), capabilities };
  if (given.callDepth > mostCallDepth) {
    return yield* tooDeep(given.callDepth);
  }
  const correlationId = given.lineage?.correlationId ?? id;
  const startedBy = recordedCallerOf(yield* Caller);
  const written = inputKeptIn(request, yield* payloadWritten({ inline: request.input }));
  const { org, playbook } = yield* PlaybookContext;
  const starting: StartOfARun = { id, request, run, given, correlationId, startedBy, place: { org, playbook } };
  yield* admittedByTheMeter(meteredRunOf(starting));
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { messageId, startedAt, modelCallsBefore, fencingToken } = yield* startRecorded(
        id,
        startOf(written, starting),
        run.definition.definition_id,
        { causationId: given.lineage?.causationId ?? null, correlationId },
      );
      const lineage = { startId: messageId, correlationId };
      const context = yield* contextOf(id, run, given, {
        lineage,
        attempt: { startedAt, modelCallsBefore, calls: [] },
        fencingToken,
      });
      return yield* answeredAttempt({ id, run, input: request.input, context, fencingToken }, restore);
    }),
  );
});
