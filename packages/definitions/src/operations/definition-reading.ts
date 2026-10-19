import type { NotFound, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { Definition, StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import type { PlaybookRegistries } from '../used-by/definition-users.ts';
import { overviewReadFrom } from '../used-by/overview-at-read.ts';
import { definitionOf } from './definition-views.ts';
import { loadRegistry, type DefinitionInRegistry } from './registry-access.ts';

export interface ReadDefinition {
  readonly stored: StoredDefinition;
  readonly definition: Definition;
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

export function answeredDefinition(
  capability: Capability,
  types: readonly string[],
  { registry, stored }: DefinitionInRegistry,
): Effect.Effect<Definition, never, PlaybookReader> {
  return Effect.map(registriesWith(types, capability.type, registry), (registries) =>
    definitionOf(capability, stored, overviewReadFrom(registries, capability.type, stored)),
  );
}

export function readDefinition(
  capability: Capability,
  types: readonly string[],
  name: string,
): Effect.Effect<ReadDefinition, NotFound, PlaybookReader> {
  return Effect.gen(function* () {
    const registry = yield* loadRegistry(capability.type);
    const stored = yield* findDefinition(registry, capability.type, name);
    return { stored, definition: yield* answeredDefinition(capability, types, { registry, stored }) };
  });
}
