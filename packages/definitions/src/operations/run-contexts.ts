import { PlaybookContext, PlaybookReader, Caller, type GivenLineage } from '@on.auto/operations';
import { Cause, Effect, Option, type Schema } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import type { RunAttempt, RunContext, RunLineage } from '../capability/run-context.ts';
import { runJournal, type LedgerJournal } from '../journal/run-journal.ts';
import type { InterruptedAttempt, RunOutcome } from '../runs/run-commands.ts';
import { preparedDefinition, type VersionToRun } from './definition-preparation.ts';
import { answerAfterAnother, answeredRun, loadCalls, loadRun } from './run-access.ts';
import { attempt, failedAttempt, interruptedAttempt, isTakenByAnother } from './run-attempt.ts';

export interface Called extends GivenLineage {
  readonly capabilities: readonly Capability[];
}

export interface Prepared {
  readonly definition: VersionToRun;
  readonly prepared: PreparedDefinition;
  readonly createOnly?: true;
}

interface JournalledRun extends RunContext {
  readonly journal: LedgerJournal;
}

export interface StartedAttempt {
  readonly lineage: RunLineage;
  readonly attempt: RunAttempt;
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

export const contextOf = Effect.fnUntraced(function* (
  id: string,
  { definition }: Prepared,
  given: Called,
  { lineage, attempt: before }: StartedAttempt,
) {
  const { org, playbook } = yield* PlaybookContext;
  const journal = yield* runJournal(id, lineage, before);
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

export function answeredWith(id: string, context: JournalledRun, outcome: RunOutcome | InterruptedAttempt) {
  return Effect.gen(function* () {
    const causationId = outcome.type === 'run_deferred' ? context.lineage.startId : yield* context.journal.latest;
    const lineage = { causationId, correlationId: context.lineage.correlationId };
    return yield* answeredRun(id, { type: 'finish', result: outcome }, lineage);
  });
}

export interface Attempting {
  readonly id: string;
  readonly run: Prepared;
  readonly input: Schema.Json;
  readonly context: JournalledRun;
}

type Restore = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

const interruptedAs = Effect.fnUntraced(function* ({ id, run, context }: Attempting) {
  const interrupted = interruptedAttempt(run.prepared.resumesAfterMs);
  if ((yield* loadRun(id))?.cancel === undefined) {
    return yield* answeredWith(id, context, interrupted);
  }
  const { ends } = run.prepared.cancelledAttempt(yield* loadCalls(id));
  yield* Effect.forEach(ends, (end) => Effect.ignore(context.journal.record(end)), { discard: true });
  const { record } = run.prepared.cancelledAttempt(yield* loadCalls(id));
  return yield* answeredWith(id, context, record === undefined ? interrupted : { ...interrupted, record });
});

export const answeredAttempt = Effect.fnUntraced(function* (attempting: Attempting, restore: Restore) {
  const { id, run, input, context } = attempting;
  const running = run.prepared.run(input, context);
  const outcome = yield* attempt(run.prepared.whenCancelled === 'finish' ? running : restore(running)).pipe(
    Effect.onError((cause) =>
      Effect.ignore(
        Cause.hasInterruptsOnly(cause) ? interruptedAs(attempting) : answeredWith(id, context, failedAttempt),
      ),
    ),
  );
  return isTakenByAnother(outcome) ? yield* answerAfterAnother(id) : yield* answeredWith(id, context, outcome);
});
