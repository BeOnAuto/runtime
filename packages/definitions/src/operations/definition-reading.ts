import type { Conflict, NotFound, PlaybookContext, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { Definition, StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { usersOf, type PlaybookRegistries } from '../used-by/definition-users.ts';
import type { DefinitionUser } from '../used-by/user-relations.ts';
import {
  definitionAnswered,
  withTheTextsInHand,
  type Answering,
  type DefinitionAnswered,
} from './answered-definitions.ts';
import { loadRegistry, type DefinitionInRegistry } from './registry-access.ts';

export interface ReadDefinition extends DefinitionAnswered {
  readonly stored: StoredDefinition;
}

export function withTheTextsRead<A, E, R>({ inHand }: ReadDefinition, effect: Effect.Effect<A, E, R>) {
  return withTheTextsInHand(inHand)(effect);
}

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

function withUsers(definition: Definition, users: readonly DefinitionUser[]): Definition {
  return users.length === 0 ? definition : { ...definition, used_by: users };
}

function answeredWithItsUsers(
  capability: Capability,
  types: readonly string[],
  { registry, stored }: DefinitionInRegistry,
  answering?: Answering,
): Effect.Effect<DefinitionAnswered, Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.zipWith(
    definitionAnswered(capability, stored, answering),
    registriesWith(types, capability.type, registry),
    ({ definition, inHand }, registries) => ({
      definition: withUsers(definition, usersOf(registries, { type: capability.type, name: stored.name })),
      inHand,
    }),
  );
}

export function answeredDefinition(
  capability: Capability,
  types: readonly string[],
  inRegistry: DefinitionInRegistry,
  answering?: Answering,
): Effect.Effect<Definition, Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.map(answeredWithItsUsers(capability, types, inRegistry, answering), ({ definition }) => definition);
}

export function readDefinition(
  capability: Capability,
  types: readonly string[],
  name: string,
): Effect.Effect<ReadDefinition, NotFound | Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const registry = yield* loadRegistry(capability.type);
    const stored = yield* findDefinition(registry, capability.type, name);
    return { stored, ...(yield* answeredWithItsUsers(capability, types, { registry, stored })) };
  });
}
