import { streamPrefixOfPlaybook, type Fold, type PlaybookAddress, type StreamReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { StrippedForms } from '../capability/stripped-forms.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from './definition-events.ts';
import { definitionTypeStreamOf } from './definitions-decider.ts';

export interface RecordedVersion {
  readonly source: string;
  readonly stripped?: StrippedForms;
  readonly position: number;
}

export interface VersionSearch {
  readonly position: number;
  readonly found: RecordedVersion | undefined;
}

function evolvedSearch(
  name: string,
  version: number,
): (search: VersionSearch, event: RecordedDefinitionEvent) => VersionSearch {
  return ({ position, found }, event) => {
    const at = position + 1;
    const { definitionName, definitionVersion } = event.context;
    if (event.type === 'definition_retired' || definitionName !== name || definitionVersion !== version) {
      return { position: at, found };
    }
    const { source, stripped } = event.data.content;
    return { position: at, found: { source, ...(stripped === undefined ? {} : { stripped }), position: at } };
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
