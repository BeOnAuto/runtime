import type { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import { usersFromTheReadModel } from '../read-model-reads/read-model-users.ts';
import { sameAnswer } from '../read-model-staging/same-answers.ts';
import { comparisonOf, matched, stagedRead, type Comparison } from '../read-model-staging/shadow-comparison.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { NamedDefinition } from './called-definitions.ts';
import { usersOf, type PlaybookRegistries } from './definition-users.ts';
import type { DefinitionUser } from './user-relations.ts';

type Users = Effect.Effect<readonly DefinitionUser[], never, PlaybookReader>;

function registriesWith(
  types: readonly string[],
  type: string,
  registry: DefinitionRegistry,
): Effect.Effect<PlaybookRegistries, never, PlaybookReader> {
  return Effect.map(
    Effect.forEach(
      types.filter((other) => other !== type),
      (other) => Effect.map(loadRegistry(other), (loaded) => [other, loaded] as const),
    ),
    (others: readonly (readonly [string, DefinitionRegistry])[]) => new Map([[type, registry], ...others]),
  );
}

export function usersToday(types: readonly string[], registry: DefinitionRegistry, used: NamedDefinition): Users {
  return Effect.map(registriesWith(types, used.type, registry), (registries) => usersOf(registries, used));
}

export function usersCompared(today: readonly DefinitionUser[], candidate: readonly DefinitionUser[]): Comparison {
  return sameAnswer(today, candidate) ? matched : comparisonOf(['used_by']);
}

function stagedUsers(
  types: readonly string[],
  used: NamedDefinition,
  today: Effect.Effect<readonly DefinitionUser[], never, PlaybookReader>,
): Effect.Effect<readonly DefinitionUser[], never, PlaybookReader> {
  return stagedRead({
    read: 'used_by',
    reading: 'answers',
    definitionType: used.type,
    involved: [used.type, ...types],
    today,
    fromTheReadModel: usersFromTheReadModel(types, used),
    answerOf: (users) => users,
    compared: (found, candidate) => Effect.succeed(usersCompared(found, candidate)),
  });
}

export function usersAnswered(types: readonly string[], registry: DefinitionRegistry, used: NamedDefinition): Users {
  return stagedUsers(types, used, usersToday(types, registry, used));
}
