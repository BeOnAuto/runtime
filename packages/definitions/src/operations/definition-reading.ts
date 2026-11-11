import type { Conflict, NotFound, PlaybookContext, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { Definition, StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import type { DefinitionUser } from '../used-by/user-relations.ts';
import { usersAnswered, usersToday } from '../used-by/users-of-a-definition.ts';
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

function withUsers(definition: Definition, users: readonly DefinitionUser[]): Definition {
  return users.length === 0 ? definition : { ...definition, used_by: users };
}

function answeredWithItsUsers(
  capability: Capability,
  stored: StoredDefinition,
  users: Effect.Effect<readonly DefinitionUser[], never, PlaybookReader | PlaybookContext>,
  answering?: Answering,
): Effect.Effect<DefinitionAnswered, Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.zipWith(definitionAnswered(capability, stored, answering), users, ({ definition, inHand }, found) => ({
    definition: withUsers(definition, found),
    inHand,
  }));
}

export function answeredDefinition(
  capability: Capability,
  types: readonly string[],
  inRegistry: DefinitionInRegistry,
  answering?: Answering,
): Effect.Effect<Definition, Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  const users = usersAnswered(types, inRegistry.registry, { type: capability.type, name: inRegistry.stored.name });
  return Effect.map(
    answeredWithItsUsers(capability, inRegistry.stored, users, answering),
    ({ definition }) => definition,
  );
}

export function readDefinition(
  capability: Capability,
  types: readonly string[],
  name: string,
): Effect.Effect<ReadDefinition, NotFound | Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const registry = yield* loadRegistry(capability.type);
    const stored = yield* findDefinition(registry, capability.type, name);
    const users = usersToday(types, registry, { type: capability.type, name: stored.name });
    return { stored, ...(yield* answeredWithItsUsers(capability, stored, users)) };
  });
}
