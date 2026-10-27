import { PlaybookContext, PlaybookReader, Caller, type GivenLineage } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import type { RunAttempt, RunContext, RunLineage } from '../capability/run-context.ts';
import { dispatchFor } from '../dispatch/run-admission.ts';
import { runJournal, type LedgerJournal } from '../journal/run-journal.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { preparedDefinition, type VersionToRun } from './definition-preparation.ts';

export interface Called extends GivenLineage {
  readonly capabilities: readonly Capability[];
}

export interface Prepared {
  readonly definition: VersionToRun;
  readonly prepared: PreparedDefinition;
  readonly createOnly?: true;
}

export interface JournalledRun extends RunContext {
  readonly journal: LedgerJournal;
}

export interface StartedAttempt {
  readonly request: RunRequest;
  readonly dispatchLineage: Pick<GivenLineage, 'calledBy' | 'trigger'>;
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
  { lineage, attempt: before, request, dispatchLineage }: StartedAttempt,
) {
  const { org, playbook } = yield* PlaybookContext;
  const journal = yield* runJournal(id, lineage, before);
  const called = yield* calledDefinitionsIn(given.capabilities);
  const context: JournalledRun = {
    beforeDispatch: yield* dispatchFor(id, definition, request, dispatchLineage),
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
