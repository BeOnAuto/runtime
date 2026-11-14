import type { Conflict, PlaybookContext, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect, Struct } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import { textsToAnswer } from '../operations/unread-texts.ts';
import { inCreationOrder, type PortableDefinition } from '../portable/portable-package.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { isRetired } from '../registry/definition.ts';

interface Exported extends PortableDefinition {
  readonly created_at: string;
}

type Reading<A> = Effect.Effect<A, Unavailable | Conflict, PlaybookReader | PlaybookContext>;

function exportedOf(type: string, stored: RegisteredDefinition): Reading<Exported> {
  const { name, status, created_at: createdAt } = stored;
  return Effect.map(textsToAnswer(type, stored), ({ source, overview, diagram }) => ({
    type,
    name,
    source,
    ...(overview === undefined ? {} : { overview }),
    ...(diagram === undefined ? {} : { diagram }),
    paused: status === 'paused',
    created_at: createdAt,
  }));
}

function standingOfType(type: string): Reading<readonly Exported[]> {
  return Effect.flatMap(loadRegistry(type), (registry) =>
    Effect.forEach(
      [...registry.values()].filter((stored) => !isRetired(stored)),
      (stored) => exportedOf(type, stored),
    ),
  );
}

export function exportedDefinitionsOf(capabilities: readonly Capability[]): Reading<readonly PortableDefinition[]> {
  return Effect.map(
    Effect.forEach(capabilities, ({ type }) => standingOfType(type)),
    (byType: readonly (readonly Exported[])[]) =>
      inCreationOrder(byType.flat()).map((definition) => Struct.omit(definition, ['created_at'])),
  );
}
