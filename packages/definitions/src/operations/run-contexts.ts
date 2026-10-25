import { PlaybookContext, PlaybookReader, Caller, type GivenLineage } from '@on.auto/operations';
import { Cause, Effect, Option, type Schema } from 'effect';

import type {
  Capability,
  CapabilityAnswer,
  CapabilityRejection,
  PreparedDefinition,
} from '../capability/capability.ts';
import type { RunAttempt, RunContext, RunLineage } from '../capability/run-context.ts';
import { runJournal, type LedgerJournal } from '../journal/run-journal.ts';
import type { InterruptedAttempt, RunOutcome } from '../runs/run-commands.ts';
import { isTaken } from '../runs/run-decisions.ts';
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

type MeasureOf = (prepared: PreparedDefinition) => number;

const measuredIn = Effect.fnUntraced(function* (capability: Capability, name: string, measureOf: MeasureOf) {
  const { prepared } = yield* preparedDefinition(capability, name);
  return measureOf(prepared);
});

const calledDefinitionsIn = Effect.fnUntraced(function* (capabilities: readonly Capability[]) {
  const reader = yield* PlaybookReader;
  return (type: string, name: string, measureOf: MeasureOf): Effect.Effect<number | undefined> => {
    const capability = capabilities.find((candidate) => candidate.type === type);
    return capability === undefined
      ? Effect.undefined
      : measuredIn(capability, name, measureOf).pipe(
          Effect.option,
          Effect.map(Option.getOrUndefined),
          Effect.provideService(PlaybookReader, reader),
        );
  };
});

function finiteOnly(milliseconds: number | undefined): number | undefined {
  return milliseconds !== undefined && Number.isFinite(milliseconds) ? milliseconds : undefined;
}

export const contextOf = Effect.fnUntraced(function* (
  id: string,
  { definition }: Prepared,
  given: Called,
  { lineage, attempt: before }: StartedAttempt,
) {
  const { org, playbook } = yield* PlaybookContext;
  const journal = yield* runJournal(id, lineage, before);
  const called = yield* calledDefinitionsIn(given.capabilities);
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
    longestRunOf: (type, name) => called(type, name, ({ longestRunMs }) => longestRunMs),
    longestRunFor: (type, name, input) => called(type, name, ({ longestRunMsFor }) => longestRunMsFor(input)),
    resumesAfterOf: (type, name) =>
      Effect.map(
        called(type, name, ({ resumesAfterMs }) => resumesAfterMs),
        finiteOnly,
      ),
  };
  return context;
});

export function answeredWith(
  id: string,
  context: JournalledRun,
  outcome: RunOutcome | InterruptedAttempt,
  number: number,
) {
  return Effect.gen(function* () {
    const causationId = outcome.type === 'run_deferred' ? context.lineage.startId : yield* context.journal.latest;
    const lineage = { causationId, correlationId: context.lineage.correlationId };
    return yield* answeredRun(id, { type: 'finish', result: outcome, attempt: number }, lineage);
  });
}

export interface AttemptOfARun {
  readonly id: string;
  readonly run: Prepared;
  readonly input: Schema.Json;
  readonly context: JournalledRun;
  readonly number: number;
}

type Restore = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

const interruptedAs = Effect.fnUntraced(function* ({ id, run, context, number }: AttemptOfARun) {
  const interrupted = interruptedAttempt(run.prepared.resumesAfterMs);
  if ((yield* loadRun(id))?.cancel === undefined) {
    return yield* answeredWith(id, context, interrupted, number);
  }
  const { ends } = run.prepared.cancelledAttempt(yield* loadCalls(id));
  yield* Effect.forEach(ends, (end) => Effect.ignore(context.journal.record(end)), { discard: true });
  const { record } = run.prepared.cancelledAttempt(yield* loadCalls(id));
  return yield* answeredWith(id, context, record === undefined ? interrupted : { ...interrupted, record }, number);
});

export const attemptEnded = Effect.fnUntraced(function* (
  attempting: AttemptOfARun,
  ran: Effect.Effect<CapabilityAnswer, CapabilityRejection>,
) {
  const { id, context, number } = attempting;
  const outcome = yield* attempt(ran).pipe(
    Effect.onError((cause) =>
      Effect.ignore(
        Cause.hasInterruptsOnly(cause) ? interruptedAs(attempting) : answeredWith(id, context, failedAttempt, number),
      ),
    ),
  );
  return isTakenByAnother(outcome)
    ? yield* answerAfterAnother(id)
    : yield* answeredWith(id, context, outcome, number).pipe(Effect.catchIf(isTaken, () => answerAfterAnother(id)));
});

export function answeredAttempt(attempting: AttemptOfARun, restore: Restore) {
  const { run, input, context } = attempting;
  const running = run.prepared.run(input, context);
  return attemptEnded(attempting, run.prepared.whenCancelled === 'finish' ? running : restore(running));
}
