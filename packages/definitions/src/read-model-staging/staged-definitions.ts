import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import { registeredFromTheReadModel, type RegisteredInTheReadModel } from '../read-model-reads/read-model-stored.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { definitionNotFound } from '../registry/registry-lookup.ts';
import type { StagedReading } from './read-model-stage.ts';
import { differingFieldsOf } from './same-answers.ts';
import { comparisonOf, matched, stagedRead, type ComparedRead, type Comparison } from './shadow-comparison.ts';

type Reading<A, E = never> = Effect.Effect<A, E, PlaybookReader | PlaybookContext>;

export interface StagedRegistered {
  readonly reading: StagedReading;
  readonly read: ComparedRead;
}

export function registeredCompared(
  today: RegisteredDefinition | undefined,
  candidate: Pick<RegisteredInTheReadModel, 'stored'> | undefined,
): Comparison {
  if (today === undefined || candidate === undefined) {
    return today === candidate ? matched : comparisonOf(['presence']);
  }
  return comparisonOf(differingFieldsOf(today, candidate.stored));
}

export const definitionToStart = Effect.fnUntraced(function* (type: string, name: string) {
  const found = yield* stagedRegistered({ reading: 'run_starts', read: 'run_start' }, type, name);
  return found ?? (yield* definitionNotFound(type, name));
});

export function stagedRegistered(
  { reading, read }: StagedRegistered,
  type: string,
  name: string,
): Reading<RegisteredDefinition | undefined> {
  return stagedRead({
    read,
    reading,
    definitionType: type,
    involved: [type],
    today: Effect.map(loadRegistry(type), (registry) => registry.get(name)),
    fromTheReadModel: registeredFromTheReadModel(type, name),
    answerOf: (found) => found?.stored,
    compared: (today, candidate) => Effect.succeed(registeredCompared(today, candidate)),
  });
}
