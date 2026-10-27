import {
  CallLineage,
  Caller,
  Conflict,
  recordedCallerOf,
  type GivenLineage,
  type RecordedCaller,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { firstAttempt, type RunRequest } from '../runs/run-commands.ts';
import { outputShapeOf } from './definition-preparation.ts';
import { contextOf, type Called, type Prepared } from './prepared-context.ts';
import { recordRun } from './run-access.ts';
import { answeredAttempt } from './run-contexts.ts';

export const mostCallDepth = 8;

function tooDeep(callDepth: number): Conflict {
  return new Conflict({
    detail: `This run would sit ${callDepth} calls below the run at the top of its tree, more than the ${mostCallDepth} a run may: workflows that call workflows reach at most ${mostCallDepth} calls deep`,
  });
}

function startOf(
  request: RunRequest,
  { definition, prepared, createOnly }: Prepared,
  given: GivenLineage,
  startedBy: RecordedCaller,
) {
  const { depth, callDepth, calledBy, trigger } = given;
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
    ...(createOnly === true ? { createOnly } : {}),
    ...(Number.isFinite(prepared.resumesAfterMs) ? { resumes: true as const } : {}),
  };
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
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const startedBy = recordedCallerOf(yield* Caller);
      const { messageId, startedAt, modelCallsBefore } = yield* recordRun(id, startOf(request, run, given, startedBy), {
        causationId: given.lineage?.causationId ?? null,
        correlationId,
      });
      const lineage = { startId: messageId, correlationId };
      const context = yield* contextOf(id, run, given, {
        request,
        dispatchLineage: given,
        lineage,
        attempt: { startedAt, modelCallsBefore, calls: [] },
      });
      return yield* answeredAttempt({ id, run, input: request.input, context, number: firstAttempt }, restore);
    }),
  );
});
