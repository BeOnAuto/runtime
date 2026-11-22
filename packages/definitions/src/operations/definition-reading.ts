import {
  PlaybookContext,
  type Conflict,
  type NotFound,
  type PlaybookAddress,
  type PlaybookReader,
  type Unavailable,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability, StandingRequest } from '../capability/capability.ts';
import type { Definition, StoredDefinition } from '../registry/definition.ts';
import type { DefinitionUser } from '../used-by/user-relations.ts';
import { usersAnswered, usersToday } from '../used-by/users-of-a-definition.ts';
import {
  definitionAnswered,
  withTheTextsInHand,
  type Answering,
  type DefinitionAnswered,
} from './answered-definitions.ts';
import { foundDefinition, type DefinitionInRegistry } from './registry-access.ts';

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

function standingRequestOf(
  address: PlaybookAddress,
  { details, triggers }: Pick<StoredDefinition, 'details' | 'triggers'>,
  {
    definition_id: definition,
    name,
    version,
    status,
  }: Pick<Definition, 'definition_id' | 'name' | 'version' | 'status'>,
): StandingRequest {
  return {
    ...address,
    definition,
    name,
    version,
    status,
    ...(details === undefined ? {} : { details }),
    ...(triggers === undefined ? {} : { triggers }),
  };
}

export function withItsStanding(
  capability: Capability,
  stored: Pick<StoredDefinition, 'details' | 'triggers'>,
  definition: Definition,
): Effect.Effect<Definition, never, PlaybookContext> {
  return Effect.gen(function* () {
    const { org, playbook } = yield* PlaybookContext;
    const standing = yield* capability.standing(standingRequestOf({ org, playbook }, stored, definition));
    return standing === undefined ? definition : { ...definition, standing };
  });
}

export function answeredWithItsStanding(
  capability: Capability,
  types: readonly string[],
  inRegistry: DefinitionInRegistry,
  answering?: Answering,
): Effect.Effect<Definition, Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.flatMap(answeredDefinition(capability, types, inRegistry, answering), (definition) =>
    withItsStanding(capability, inRegistry.stored, definition),
  );
}

export function answeredDefinition(
  capability: Capability,
  types: readonly string[],
  inRegistry: DefinitionInRegistry,
  answering?: Answering,
): Effect.Effect<Definition, Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  const users = usersAnswered(types, { type: capability.type, name: inRegistry.stored.name });
  return Effect.map(
    answeredWithItsUsers(capability, inRegistry.stored, users, answering),
    ({ definition }) => definition,
  );
}

export function readDefinition(
  capability: Capability,
  types: readonly string[],
  name: string,
  goals = false,
): Effect.Effect<ReadDefinition, NotFound | Unavailable | Conflict, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const stored = yield* foundDefinition(capability.type, name);
    const users = usersToday(types, { type: capability.type, name: stored.name });
    return { stored, ...(yield* answeredWithItsUsers(capability, stored, users, { goals })) };
  });
}
