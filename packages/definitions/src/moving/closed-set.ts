import { Conflict, type PlaybookReader } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import { namingDetailsOf, usersOf, type PlaybookRegistries } from '../used-by/definition-users.ts';
import { distinct, isOneOf, type Member } from './move-members.ts';
import { incompleteWords, inUseWords, type Named } from './move-words.ts';

function namedBy({ stored }: Member): readonly Named[] {
  const { calls = [], reads = [] } = namingDetailsOf(stored.details);
  return distinct([...calls, ...reads].map(({ type, name }) => ({ type, name })));
}

function recordOf(named: readonly Named[]) {
  return { definitions: named.map(({ type, name }) => ({ type, name })) };
}

function incompleteRefusal(members: readonly Member[]): Conflict | undefined {
  const isMember = isOneOf(members);
  const [refusal] = members.flatMap((member) => {
    const missing = namedBy(member).filter((named) => !isMember(named));
    return missing.length === 0
      ? []
      : [new Conflict({ detail: incompleteWords(member, missing), kind: 'incomplete', record: recordOf(missing) })];
  });
  return refusal;
}

function inUseRefusal(members: readonly Member[], registries: PlaybookRegistries): Conflict | undefined {
  const isMember = isOneOf(members);
  const [refusal] = members.flatMap((member) => {
    const staying = distinct(usersOf(registries, member).filter((user) => !isMember(user)));
    return staying.length === 0
      ? []
      : [new Conflict({ detail: inUseWords(member, staying), kind: 'in_use', record: recordOf(staying) })];
  });
  return refusal;
}

function registriesOf(types: readonly string[]): Effect.Effect<PlaybookRegistries, never, PlaybookReader> {
  return Effect.map(
    Effect.forEach(types, (type) => Effect.map(loadRegistry(type), (registry) => [type, registry] as const)),
    (loaded: readonly (readonly [string, DefinitionRegistry])[]) => new Map(loaded),
  );
}

export function closedSetRefused(
  types: readonly string[],
  members: readonly Member[],
): Effect.Effect<void, Conflict, PlaybookReader> {
  const incomplete = incompleteRefusal(members);
  return incomplete === undefined
    ? Effect.flatMap(registriesOf(types), (registries) =>
        Option.match(Option.fromNullishOr(inUseRefusal(members, registries)), {
          onNone: () => Effect.void,
          onSome: Effect.fail,
        }),
      )
    : Effect.fail(incomplete);
}
