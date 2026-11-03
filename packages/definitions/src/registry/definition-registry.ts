import type { DefinitionContext } from '@on.auto/operations';

import type { PageContent } from '../page/page-facts.ts';
import type { DefinitionCreated, DefinitionUpdated, RecordedDefinitionEvent } from './definition-events.ts';
import type { StoredDefinition } from './definition.ts';

export type RegisteredDefinition = StoredDefinition & { readonly page?: PageContent | null };

export type DefinitionRegistry = ReadonlyMap<string, RegisteredDefinition>;

export const initialRegistry: DefinitionRegistry = new Map();

function createdDefinition({ data, context }: DefinitionCreated): RegisteredDefinition {
  const { at, definitionName: name, definitionVersion: version } = context;
  const { content, created_by } = data;
  return { name, version, status: 'active', ...content, created_at: at, created_by, updated_at: at };
}

function updatedDefinition(
  { name, status, created_at, created_by }: RegisteredDefinition,
  { data, context }: DefinitionUpdated,
): RegisteredDefinition {
  const { at, definitionVersion: version } = context;
  return { name, version, status, ...data.content, created_at, created_by, updated_at: at };
}

function retiredDefinition(definition: RegisteredDefinition, { at }: DefinitionContext): RegisteredDefinition {
  return { ...definition, status: 'retired', updated_at: at, retired_at: at };
}

function withDefinition(registry: DefinitionRegistry, definition: RegisteredDefinition): DefinitionRegistry {
  return new Map(registry).set(definition.name, definition);
}

export function evolveRegistry(registry: DefinitionRegistry, event: RecordedDefinitionEvent): DefinitionRegistry {
  if (event.type === 'definition_created') {
    return withDefinition(registry, createdDefinition(event));
  }
  const definition = registry.get(event.context.definitionName);
  if (definition === undefined) {
    return registry;
  }
  return withDefinition(
    registry,
    event.type === 'definition_updated'
      ? updatedDefinition(definition, event)
      : retiredDefinition(definition, event.context),
  );
}
