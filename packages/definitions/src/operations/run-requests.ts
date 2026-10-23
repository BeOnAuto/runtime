import { PlaybookContext, PlaybookReader, CallLineage, Caller, Conflict, type GivenLineage } from '@on.auto/operations';
import { Cause, Effect, Option } from 'effect';

import type { Capability, PreparedDefinition, RunContext, RunLineage } from '../capability/capability.ts';
import { runJournal, type LedgerJournal } from '../journal/run-journal.ts';
import type { RunOutcome, RunRequest, InterruptedAttempt } from '../runs/run-commands.ts';
import { claimOf, runTaken } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { outputShapeOf, preparedDefinition, preparedVersion, type VersionToRun } from './definition-preparation.ts';
import { loadRun, loadRunStream, newRunId, recordRun } from './run-access.ts';
import { attempt, failedAttempt, interruptedAttempt } from './run-attempt.ts';

export const mostCallDepth = 8;

interface JournalledRun extends RunContext {
  readonly journal: LedgerJournal;
}

interface Called extends GivenLineage {
  readonly capabilities: readonly Capability[];
}

interface StartedAttempt {
  readonly lineage: RunLineage;
  readonly journal: LedgerJournal;
}

function finishedBy(id: string, context: JournalledRun, outcome: RunOutcome | InterruptedAttempt) {
  return Effect.gen(function* () {
    const causationId = outcome.type === 'run_deferred' ? context.lineage.startId : yield* context.journal.latest;
    const lineage = { causationId, correlationId: context.lineage.correlationId };
    return yield* recordRun(id, { type: 'finish', result: outcome }, lineage);
  });
}

interface Prepared {
  readonly definition: VersionToRun;
  readonly prepared: PreparedDefinition;
  readonly createOnly?: true;
}

function tooDeep(callDepth: number): Conflict {
  return new Conflict({
    detail: `This run would sit ${callDepth} calls below the run at the top of its tree, more than the ${mostCallDepth} a run may: workflows that call workflows reach at most ${mostCallDepth} calls deep`,
  });
}

type LongestOf = (prepared: PreparedDefinition) => number;

const longestRunIn = Effect.fnUntraced(function* (capability: Capability, name: string, longestOf: LongestOf) {
  const { prepared } = yield* preparedDefinition(capability, name);
  return longestOf(prepared);
});

const longestRunsIn = Effect.fnUntraced(function* (capabilities: readonly Capability[]) {
  const reader = yield* PlaybookReader;
  return (type: string, name: string, longestOf: LongestOf): Effect.Effect<number | undefined> => {
    const capability = capabilities.find((candidate) => candidate.type === type);
    return capability === undefined
      ? Effect.undefined
      : longestRunIn(capability, name, longestOf).pipe(
          Effect.option,
          Effect.map(Option.getOrUndefined),
          Effect.provideService(PlaybookReader, reader),
        );
  };
});

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
  };
}

const contextOf = Effect.fnUntraced(function* (
  id: string,
  { definition }: Prepared,
  given: Called,
  { lineage, journal }: StartedAttempt,
) {
  const { org, playbook } = yield* PlaybookContext;
  const longestRun = yield* longestRunsIn(given.capabilities);
  const context: JournalledRun = {
    id,
    org,
    playbook,
    caller: yield* Caller,
    definition: { name: definition.name, version: definition.version },
    journal,
    lineage,
    depth: given.depth,
    callDepth: given.callDepth,
    ...(given.calledBy === null ? {} : { calledBy: given.calledBy }),
    ...(given.trigger === null ? {} : { trigger: given.trigger }),
    longestRunOf: (type, name) => longestRun(type, name, ({ longestRunMs }) => longestRunMs),
    longestRunFor: (type, name, input) => longestRun(type, name, ({ longestRunMsFor }) => longestRunMsFor(input)),
  };
  return context;
});

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
  const recorded = yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { messageId, state } = yield* recordRun(id, startOf(request, run, given), {
        causationId: given.lineage?.causationId ?? null,
        correlationId,
      });
      const lineage = { startId: messageId, correlationId };
      const context = yield* contextOf(id, run, given, { lineage, journal: yield* runJournal(id, lineage, state) });
      const running = run.prepared.run(request.input, context);
      const result = yield* attempt(run.prepared.whenCancelled === 'finish' ? running : restore(running)).pipe(
        Effect.onError((cause) =>
          Effect.ignore(finishedBy(id, context, Cause.hasInterruptsOnly(cause) ? interruptedAttempt : failedAttempt)),
        ),
      );
      return yield* finishedBy(id, context, result);
    }),
  );
  return yield* answerOf(id, recorded.state);
});

export const runRequest = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest,
  suppliedId: string | undefined,
) {
  const id = suppliedId ?? (yield* newRunId);
  const recorded = yield* loadRunStream(id);
  const claim = yield* Effect.fromResult(claimOf(recorded, request));
  return claim === 'answer'
    ? yield* answerOf(id, recorded)
    : yield* runPrepared(capabilities, id, request, yield* preparedDefinition(capability, request.name));
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
