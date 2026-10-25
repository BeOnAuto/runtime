import { PlaybookContext, CallLineage, Conflict, NotFound, type GivenLineage } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { attemptKeyOf, LiveAttempts } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { attemptIsLive, claimOf, runTaken, stillRunning, type Claim } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { outputShapeOf, preparedDefinition, preparedVersion } from './definition-preparation.ts';
import { loadAttempt, loadRun, loadRunStream, loadStartedRun, newRunId, recordRun } from './run-access.ts';
import {
  answeredAttempt,
  answeredWith,
  contextOf,
  type AttemptOfARun,
  type Called,
  type Prepared,
} from './run-contexts.ts';

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

interface ResumedAttempt extends AttemptOfARun {
  readonly cancelAsked: boolean;
}

type Resuming = Extract<Claim, { readonly type: 'resume' }>;

type AnswerOfARun = Effect.Success<ReturnType<typeof answerOf>>;

export type NextAttempt =
  | { readonly type: 'answered'; readonly answer: AnswerOfARun }
  | { readonly type: 'attempt'; readonly attempt: AttemptOfARun };

const noStartedRun = new NotFound({ detail: 'There is no such run in this playbook' });

const resumedAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  run: Resuming['run'],
) {
  const toRun = yield* preparedVersion(capability, run.run.name, run.run.definition_version);
  const given: Called = { ...(yield* CallLineage), capabilities };
  const { attempt, quietMs, lastMessageId } = yield* loadAttempt(id);
  const cancelAsked = run.cancel !== undefined;
  if (!cancelAsked && !given.attemptDied && attemptIsLive(quietMs, toRun.prepared.resumesAfterMs)) {
    return yield* stillRunning;
  }
  const lineage = { startId: lastMessageId, correlationId: given.lineage?.correlationId ?? id };
  const context = yield* contextOf(id, toRun, given, { lineage, attempt });
  const resumed: ResumedAttempt = { id, run: toRun, input: run.input, context, cancelAsked };
  return resumed;
});

function interruptedByItsCancel({ id, context }: AttemptOfARun) {
  return answeredWith(id, context, { type: 'run_interrupted' });
}

export const nextAttemptOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
) {
  const { recorded, run } = yield* loadStartedRun(id);
  if (run === undefined) {
    return yield* Effect.fail(noStartedRun);
  }
  const request = { definition_type: capability.type, name: run.run.name, input: run.input };
  const claim = yield* Effect.fromResult(claimOf(recorded, request, capability.resumes));
  if (claim.type !== 'resume') {
    const answered: NextAttempt = { type: 'answered', answer: yield* answerOf(id, recorded) };
    return answered;
  }
  const resumed = yield* resumedAttemptOf(capabilities, capability, id, claim.run);
  const next: NextAttempt = resumed.cancelAsked
    ? { type: 'answered', answer: yield* interruptedByItsCancel(resumed) }
    : { type: 'attempt', attempt: resumed };
  return next;
});

const resumedRun = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  id: string,
  { run: state }: Resuming,
) {
  const resumed = yield* resumedAttemptOf(capabilities, capability, id, state);
  return yield* Effect.uninterruptibleMask((restore) =>
    resumed.cancelAsked ? interruptedByItsCancel(resumed) : answeredAttempt(resumed, restore),
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
