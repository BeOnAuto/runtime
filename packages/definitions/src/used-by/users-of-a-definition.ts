import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import { usersFromTheReadModel } from '../read-model-reads/read-model-users.ts';
import { sameAnswer } from '../read-model-staging/same-answers.ts';
import { comparisonOf, matched, stagedRead, type Comparison } from '../read-model-staging/shadow-comparison.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { NamedDefinition } from './called-definitions.ts';
import { usersOf, type PlaybookRegistries } from './definition-users.ts';
import type { DefinitionUser } from './user-relations.ts';

type UsersToday = Effect.Effect<readonly DefinitionUser[], never, PlaybookReader | PlaybookContext>;

type Users = Effect.Effect<readonly DefinitionUser[], never, PlaybookReader | PlaybookContext>;

export function registriesOf(types: readonly string[]): Effect.Effect<PlaybookRegistries, never, PlaybookReader> {
  return Effect.map(
    Effect.forEach(types, (type) => Effect.map(loadRegistry(type), (loaded) => [type, loaded] as const)),
    (registries: readonly (readonly [string, DefinitionRegistry])[]) => new Map(registries),
  );
}

export function usersToday(types: readonly string[], used: NamedDefinition): UsersToday {
  return Effect.map(registriesOf([...new Set([used.type, ...types])]), (registries) => usersOf(registries, used));
}

export function usersCompared(today: readonly DefinitionUser[], candidate: readonly DefinitionUser[]): Comparison {
  return sameAnswer(today, candidate) ? matched : comparisonOf(['used_by']);
}

function stagedUsers(
  types: readonly string[],
  used: NamedDefinition,
  today: Effect.Effect<readonly DefinitionUser[], never, PlaybookReader | PlaybookContext>,
): Users {
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

export function usersAnswered(types: readonly string[], used: NamedDefinition): Users {
  return stagedUsers(types, used, usersToday(types, used));
}
