import {
  streamPrefixOfPlaybook,
  type Fold,
  type LedgerPorts,
  type PlaybookAddress,
  type StreamReader,
} from '@on.auto/operations';
import { payloadOf, type Payload } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import type { StrippedForms } from '../capability/stripped-forms.ts';
import { DefinitionEventSchema, isDefinitionSaved, type RecordedDefinitionEvent } from './definition-events.ts';
import { definitionTypeStreamOf } from './definitions-decider.ts';

export interface RecordedVersion {
  readonly source: Payload<string>;
  readonly stripped?: StrippedForms;
  readonly position: number;
  readonly putInPlaceBy: string;
}

export interface VersionSearch {
  readonly position: number;
  readonly found: RecordedVersion | undefined;
}

function isOfTheVersion(event: RecordedDefinitionEvent, version: number): boolean {
  return event.context.definitionVersion === version;
}

function foundAfter(
  found: RecordedVersion | undefined,
  event: RecordedDefinitionEvent,
  at: number,
): RecordedVersion | undefined {
  if (isDefinitionSaved(event)) {
    const { content } = event.data;
    const { stripped } = content;
    return {
      source: payloadOf<'source', string>(content, 'source'),
      ...(stripped === undefined ? {} : { stripped }),
      position: at,
      putInPlaceBy: event.context.by,
    };
  }
  return found !== undefined && event.type === 'definition_restored'
    ? { ...found, putInPlaceBy: event.context.by }
    : found;
}

function evolvedSearch(version: number): (search: VersionSearch, event: RecordedDefinitionEvent) => VersionSearch {
  return ({ position, found }, event) => {
    const at = position + 1;
    return { position: at, found: isOfTheVersion(event, version) ? foundAfter(found, event, at) : found };
  };
}

export function definitionVersionFold(version: number): Fold<VersionSearch, RecordedDefinitionEvent> {
  return {
    initialState: { position: 0, found: undefined },
    evolve: evolvedSearch(version),
    eventSchema: DefinitionEventSchema,
  };
}

export interface DefinitionVersionAddress {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}

export type DefinitionVersionReader = StreamReader & Pick<LedgerPorts, 'holderOfName'>;

export function definitionVersionIn(
  reader: DefinitionVersionReader,
  playbook: PlaybookAddress,
  { type, name, version }: DefinitionVersionAddress,
): Effect.Effect<RecordedVersion | undefined> {
  const named = { playbookKey: streamPrefixOfPlaybook(playbook), definitionType: type, name };
  return Effect.flatMap(reader.holderOfName(named), (held) =>
    held === undefined
      ? Effect.undefined
      : Effect.map(
          reader.load(`${held.definitionKey}${definitionTypeStreamOf(type)}`, definitionVersionFold(version)),
          ({ state }) => state.found,
        ),
  );
}
