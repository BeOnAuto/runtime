import type { DefinitionContext } from '@on.auto/operations';
import { Struct } from 'effect';

import type { PageContent } from '../page/page-facts.ts';
import type {
  DefinitionCreated,
  DefinitionPaused,
  DefinitionUpdated,
  RecordedDefinitionEvent,
} from './definition-events.ts';
import type { StoredDefinition } from './definition.ts';

export type RegisteredDefinition = StoredDefinition & { readonly page?: PageContent | null };

export type DefinitionRegistry = ReadonlyMap<string, RegisteredDefinition>;

export const initialRegistry: DefinitionRegistry = new Map();

const whilePaused = ['paused_at', 'paused_by', 'reason'] as const;

const keptAcrossVersions = ['status', 'created_at', 'created_by', ...whilePaused] as const;

function createdDefinition({ data, context }: DefinitionCreated): RegisteredDefinition {
  const { at, definitionName: name, definitionVersion: version } = context;
  const { content, created_by } = data;
  return { name, version, status: 'active', ...content, created_at: at, created_by, updated_at: at };
}

function updatedDefinition(
  definition: RegisteredDefinition,
  { data, context }: DefinitionUpdated,
): RegisteredDefinition {
  const { at, definitionVersion: version } = context;
  return {
    name: definition.name,
    version,
    ...data.content,
    ...Struct.pick(definition, keptAcrossVersions),
    updated_at: at,
  };
}

function pausedDefinition(definition: RegisteredDefinition, { data, context }: DefinitionPaused): RegisteredDefinition {
  const { at } = context;
  const { paused_by, reason } = data;
  return { ...definition, status: 'paused', paused_at: at, paused_by, ...(reason === undefined ? {} : { reason }) };
}

function resumedDefinition(definition: RegisteredDefinition): RegisteredDefinition {
  return { ...Struct.omit(definition, whilePaused), status: 'active' };
}

function retiredDefinition(definition: RegisteredDefinition, { at }: DefinitionContext): RegisteredDefinition {
  return { ...Struct.omit(definition, whilePaused), status: 'retired', updated_at: at, retired_at: at };
}

function evolvedDefinition(
  definition: RegisteredDefinition,
  event: Exclude<RecordedDefinitionEvent, DefinitionCreated>,
): RegisteredDefinition {
  if (event.type === 'definition_updated') {
    return updatedDefinition(definition, event);
  }
  if (event.type === 'definition_paused') {
    return pausedDefinition(definition, event);
  }
  return event.type === 'definition_resumed'
    ? resumedDefinition(definition)
    : retiredDefinition(definition, event.context);
}

function withDefinition(registry: DefinitionRegistry, definition: RegisteredDefinition): DefinitionRegistry {
  return new Map(registry).set(definition.name, definition);
}

export function evolveRegistry(registry: DefinitionRegistry, event: RecordedDefinitionEvent): DefinitionRegistry {
  if (event.type === 'definition_created') {
    return withDefinition(registry, createdDefinition(event));
  }
  const definition = registry.get(event.context.definitionName);
  return definition === undefined ? registry : withDefinition(registry, evolvedDefinition(definition, event));
}
