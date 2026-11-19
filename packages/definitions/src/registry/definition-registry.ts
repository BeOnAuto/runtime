import type { DefinitionContext } from '@on.auto/operations';
import { Struct } from 'effect';

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

export type DefinitionState = RegisteredDefinition | undefined;

const whilePaused = ['paused_at', 'paused_by', 'reason'] as const;

const keptAcrossVersions = ['definition_id', 'status', 'created_at', 'created_by', ...whilePaused] as const;

type StandingAtCreation = Pick<StoredDefinition, 'status' | (typeof whilePaused)[number]>;

function standingAtCreation({ created_by, paused }: DefinitionCreated['data'], at: string): StandingAtCreation {
  if (paused === undefined) {
    return { status: 'active' };
  }
  const { reason } = paused;
  return { status: 'paused', paused_at: at, paused_by: created_by, ...(reason === undefined ? {} : { reason }) };
}

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

function createdDefinition(definition: string, { data, context }: DefinitionCreated): RegisteredDefinition {
  const { at, definitionName: name, definitionVersion: version } = context;
  const { content, created_by } = data;
  return {
    name,
    definition_id: definition,
    version,
    ...standingAtCreation(data, at),
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
  if (event.type === 'definition_moved') {
    return definition;
  }
  if (event.type === 'definition_renamed') {
    return { ...definition, name: event.data.to };
  }
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

export function definitionEvolvedIn(
  definition: string,
): (state: DefinitionState, event: RecordedDefinitionEvent) => DefinitionState {
  return (state, event) => {
    if (event.type === 'definition_created') {
      return createdDefinition(definition, event);
    }
    return state === undefined ? undefined : evolvedDefinition(state, event);
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
