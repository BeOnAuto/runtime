import { streamPrefixOfPlaybook, type Fold, type PlaybookAddress, type StreamReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { StrippedForms } from '../capability/stripped-forms.ts';
import { DefinitionEventSchema, isDefinitionSaved, type RecordedDefinitionEvent } from './definition-events.ts';
import { definitionTypeStreamOf } from './definitions-decider.ts';

export interface RecordedVersion {
  readonly source: string;
  readonly stripped?: StrippedForms;
  readonly position: number;
  readonly putInPlaceBy: string;
}

export interface VersionSearch {
  readonly position: number;
  readonly found: RecordedVersion | undefined;
}

function isOfTheVersion(event: RecordedDefinitionEvent, name: string, version: number): boolean {
  const { definitionName, definitionVersion } = event.context;
  return definitionName === name && definitionVersion === version;
}

function foundAfter(
  found: RecordedVersion | undefined,
  event: RecordedDefinitionEvent,
  at: number,
): RecordedVersion | undefined {
  if (isDefinitionSaved(event)) {
    const { source, stripped } = event.data.content;
    return { source, ...(stripped === undefined ? {} : { stripped }), position: at, putInPlaceBy: event.context.by };
  }
  return found !== undefined && event.type === 'definition_restored'
    ? { ...found, putInPlaceBy: event.context.by }
    : found;
}

function evolvedSearch(
  name: string,
  version: number,
): (search: VersionSearch, event: RecordedDefinitionEvent) => VersionSearch {
  return ({ position, found }, event) => {
    const at = position + 1;
    return { position: at, found: isOfTheVersion(event, name, version) ? foundAfter(found, event, at) : found };
  };
}

export function definitionVersionFold(name: string, version: number): Fold<VersionSearch, RecordedDefinitionEvent> {
  return {
    initialState: { position: 0, found: undefined },
    evolve: evolvedSearch(name, version),
    eventSchema: DefinitionEventSchema,
  };
}

export interface DefinitionVersionAddress {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}

export function definitionVersionIn(
  reader: StreamReader,
  playbook: PlaybookAddress,
  { type, name, version }: DefinitionVersionAddress,
): Effect.Effect<RecordedVersion | undefined> {
  const stream = `${streamPrefixOfPlaybook(playbook)}${definitionTypeStreamOf(type)}`;
  return Effect.map(reader.load(stream, definitionVersionFold(name, version)), ({ state }) => state.found);
}
