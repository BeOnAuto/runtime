import type { DefinitionContext, PlaybookAddress } from '@on.auto/operations';
import { Struct } from 'effect';

import { earlierDefinitionIdOf } from '../identity/definition-ids.ts';
import type { PageContent } from '../page/page-facts.ts';
import { isTheSameText, textMemberNames, textMembersOf, textsOf } from '../payloads/definition-texts.ts';
import type {
  DefinitionContent,
  DefinitionCreated,
  DefinitionPaused,
  DefinitionRestored,
  DefinitionUpdated,
  RecordedDefinitionEvent,
} from './definition-events.ts';
import type { StoredDefinition } from './definition.ts';

export type RegisteredDefinition = StoredDefinition & { readonly page?: PageContent | null };

export type DefinitionRegistry = ReadonlyMap<string, RegisteredDefinition>;

export const initialRegistry: DefinitionRegistry = new Map();

const whilePaused = ['paused_at', 'paused_by', 'reason'] as const;

const keptAcrossVersions = ['definition_id', 'status', 'created_at', 'created_by', ...whilePaused] as const;

export function storedContentOf(content: DefinitionContent) {
  const {
    source: _source,
    source_sha256: _sourceDigest,
    source_bytes: _sourceBytes,
    overview: _overview,
    overview_sha256: _overviewDigest,
    overview_bytes: _overviewBytes,
    diagram: _diagram,
    diagram_sha256: _diagramDigest,
    diagram_bytes: _diagramBytes,
    ...apartFromItsTexts
  } = content;
  return { ...apartFromItsTexts, ...textsOf(content) };
}

function createdDefinition(address: PlaybookAddress, { data, context }: DefinitionCreated): RegisteredDefinition {
  const { at, definitionType: type, definitionName: name, definitionVersion: version } = context;
  const { content, created_by, definition_id: given } = data;
  return {
    name,
    definition_id: given ?? earlierDefinitionIdOf({ ...address, type, name }),
    version,
    status: 'active',
    ...storedContentOf(content),
    created_at: at,
    created_by,
    updated_at: at,
  };
}

function updatedDefinition(
  definition: RegisteredDefinition,
  { data, context }: DefinitionUpdated,
): RegisteredDefinition {
  const { at, definitionVersion: version } = context;
  return {
    name: definition.name,
    version,
    ...storedContentOf(data.content),
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

function restoredDefinition(
  definition: RegisteredDefinition,
  { data, context: { at } }: DefinitionRestored,
): RegisteredDefinition {
  return {
    ...Struct.omit(definition, ['retired_at']),
    status: 'paused',
    paused_at: at,
    paused_by: data.restored_by,
    updated_at: at,
  };
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
  if (event.type === 'definition_restored') {
    return restoredDefinition(definition, event);
  }
  return event.type === 'definition_resumed'
    ? resumedDefinition(definition)
    : retiredDefinition(definition, event.context);
}

function withDefinition(registry: DefinitionRegistry, definition: RegisteredDefinition): DefinitionRegistry {
  return new Map(registry).set(definition.name, definition);
}

export function registryEvolvedIn(
  address: PlaybookAddress,
): (registry: DefinitionRegistry, event: RecordedDefinitionEvent) => DefinitionRegistry {
  return (registry, event) => {
    if (event.type === 'definition_created') {
      return withDefinition(registry, createdDefinition(address, event));
    }
    const definition = registry.get(event.context.definitionName);
    return definition === undefined ? registry : withDefinition(registry, evolvedDefinition(definition, event));
  };
}

export function withTheSavedOverview(content: DefinitionContent, saved: StoredDefinition): DefinitionContent {
  const texts = textsOf(content);
  return texts.overview === undefined && saved.overview !== undefined
    ? { ...Struct.omit(content, textMemberNames), ...textMembersOf({ ...texts, overview: saved.overview }) }
    : content;
}

export function isAsSaved(content: DefinitionContent, saved: StoredDefinition): boolean {
  const { source, overview, diagram } = textsOf(content);
  return (
    isTheSameText(source, saved.source) &&
    isTheSameText(overview, saved.overview) &&
    isTheSameText(diagram, saved.diagram)
  );
}

const contentKeys = [
  'description',
  'input_schema',
  'output_schema',
  'warnings',
  'triggers',
  'details',
  'stripped',
  'page',
] as const;

export function contentOf(definition: RegisteredDefinition): DefinitionContent {
  return { ...textMembersOf(definition), ...Struct.pick(definition, contentKeys) };
}
