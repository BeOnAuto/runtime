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
import { claimOf, isTaken } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { outputShapeOf, preparedDefinition, preparedVersion } from './definition-preparation.ts';
import { interruptedByItsCancel, resumedAttemptOf, type Resumed } from './next-attempts.ts';
import { loadRun, loadRunStream, recordRun } from './run-access.ts';
import { answeredAttempt, contextOf, type Called, type Prepared } from './run-contexts.ts';

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

const runPrepared = Effect.fnUntraced(function* (
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
        lineage,
        attempt: { startedAt, modelCallsBefore, calls: [] },
      });
      return yield* answeredAttempt({ id, run, input: request.input, context, number: firstAttempt }, restore);
    }),
  );
});

const resumedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  state: Resumed,
) {
  const resumed = yield* resumedAttemptOf(capabilities, capability, id, state);
  return yield* Effect.uninterruptibleMask((restore) =>
    resumed.cancelAsked ? interruptedByItsCancel(resumed) : answeredAttempt(resumed, restore),
  );
});

export const requestedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest,
  id: string,
) {
  const recorded = yield* loadRunStream(id);
  const claim = yield* Effect.fromResult(claimOf(recorded, request, capability.resumes));
  if (claim.type === 'answer') {
    return yield* answerOf(id, recorded);
  }
  return claim.type === 'resume'
    ? yield* resumedRun(capabilities, capability, id, claim.run)
    : yield* runPrepared(capabilities, id, request, yield* preparedDefinition(capability, request.name));
});

export const startVersionOnce = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest & { readonly version: number },
  id: string,
) {
  const { version, ...asked } = request;
  const run = yield* preparedVersion(capability, asked.name, version);
  return yield* runPrepared(capabilities, id, asked, { ...run, createOnly: true }).pipe(
    Effect.catchIf(isTaken, () => Effect.flatMap(loadRun(id), (recorded) => answerOf(id, recorded))),
  );
});
