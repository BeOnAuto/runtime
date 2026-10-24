import { PlaybookContext, CallLineage, Conflict, type GivenLineage } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { attemptKeyOf, LiveAttempts } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { attemptIsLive, claimOf, runTaken, stillRunning, type Claim } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { outputShapeOf, preparedDefinition, preparedVersion } from './definition-preparation.ts';
import { loadAttempt, loadRun, loadRunStream, newRunId, recordRun } from './run-access.ts';
import { answeredAttempt, answeredWith, contextOf, type Called, type Prepared } from './run-contexts.ts';

export const mostCallDepth = 8;

function tooDeep(callDepth: number): Conflict {
  return new Conflict({
    detail: `This run would sit ${callDepth} calls below the run at the top of its tree, more than the ${mostCallDepth} a run may: workflows that call workflows reach at most ${mostCallDepth} calls deep`,
  });
}

function startOf(request: RunRequest, { definition, prepared, createOnly }: Prepared, given: GivenLineage) {
  const { depth, callDepth, calledBy, trigger } = given;
  const shape = outputShapeOf(prepared, request.input);
  return {
    type: 'start' as const,
    ...request,
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
      const { messageId, startedAt, modelCallsBefore } = yield* recordRun(id, startOf(request, run, given), {
        causationId: given.lineage?.causationId ?? null,
        correlationId,
      });
      const lineage = { startId: messageId, correlationId };
      const context = yield* contextOf(id, run, given, {
        lineage,
        attempt: { startedAt, modelCallsBefore, calls: [] },
      });
      return yield* answeredAttempt({ id, run, input: request.input, context }, restore);
    }),
  );
});

type Resuming = Extract<Claim, { readonly type: 'resume' }>;

const resumedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  { run: state }: Resuming,
) {
  const run = yield* preparedVersion(capability, state.run.name, state.run.definition_version);
  const given: Called = { ...(yield* CallLineage), capabilities };
  const { attempt, quietMs, lastMessageId } = yield* loadAttempt(id);
  if (state.cancel === undefined && !given.attemptDied && attemptIsLive(quietMs, run.prepared.resumesAfterMs)) {
    return yield* stillRunning;
  }
  const lineage = { startId: lastMessageId, correlationId: given.lineage?.correlationId ?? id };
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const context = yield* contextOf(id, run, given, { lineage, attempt });
      return state.cancel === undefined
        ? yield* answeredAttempt({ id, run, input: state.input, context }, restore)
        : yield* answeredWith(id, context, { type: 'run_interrupted' });
    }),
  );
});

const requestedRun = Effect.fnUntraced(function* (
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
    ? yield* resumedRun(capabilities, capability, id, claim)
    : yield* runPrepared(capabilities, id, request, yield* preparedDefinition(capability, request.name));
});

export const runRequest = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest,
  suppliedId: string | undefined,
) {
  const id = suppliedId ?? (yield* newRunId);
  const requested = requestedRun(capabilities, capability, request, id);
  const live = yield* Effect.serviceOption(LiveAttempts);
  if (Option.isNone(live)) {
    return yield* requested;
  }
  const key = attemptKeyOf(yield* PlaybookContext, id);
  const { calledBy } = yield* CallLineage;
  return yield* capability.resumes && calledBy === null
    ? live.value.outliving(key, requested)
    : live.value.attempt(key, requested);
});

function isTaken(error: unknown): error is Conflict {
  return error instanceof Conflict && error.kind === runTaken.kind;
}

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
