import type { NotFound, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { Definition, StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { definitionOf } from './definition-views.ts';
import { loadRegistry } from './registry-access.ts';

export interface ReadDefinition {
  readonly stored: StoredDefinition;
  readonly definition: Definition;
}

export function readDefinition(
  capability: Capability,
  name: string,
): Effect.Effect<ReadDefinition, NotFound, PlaybookReader> {
  return Effect.map(
    Effect.flatMap(loadRegistry(capability.type), (registry) => findDefinition(registry, capability.type, name)),
    (stored) => ({ stored, definition: definitionOf(capability, stored) }),
  );
}
