import type { Conflict, NotFound, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { KnownCapabilities } from '../capability/known-capabilities.ts';
import { foundDefinition } from '../operations/registry-access.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { isRetired } from '../registry/definition.ts';
import { retiredRefusal } from './move-decider.ts';
import type { Named } from './move-words.ts';

export interface Member extends Named {
  readonly capability: Capability;
  readonly stored: RegisteredDefinition;
}

export function isOneOf(named: readonly Named[]): (one: Named) => boolean {
  return ({ type, name }) => named.some((other) => other.type === type && other.name === name);
}

export function distinct(named: readonly Named[]): readonly Named[] {
  return named.filter((one, index) => !isOneOf(named.slice(0, index))(one));
}

function heldMember(known: KnownCapabilities, { type, name }: Named) {
  return Effect.gen(function* () {
    const capability = yield* known.capabilityOfType(type);
    const stored = yield* foundDefinition(type, name);
    if (isRetired(stored)) {
      return yield* Effect.fail(retiredRefusal(type, name));
    }
    const member: Member = { type, name, capability, stored };
    return member;
  });
}

export function membersHeld(
  known: KnownCapabilities,
  named: readonly Named[],
): Effect.Effect<readonly Member[], NotFound | Conflict, PlaybookReader> {
  return Effect.forEach(distinct(named), (one) => heldMember(known, one));
}
