import { Buffer } from 'node:buffer';

import { changingOne, type Presenter } from '@on.auto/operations';

import { firstCharacters } from '../plain-language/characters.ts';
import type { DefinitionWords } from '../plain-language/definition-words.ts';
import { definitionCreated, definitionRetired, definitionUpdated } from '../plain-language/event-words.ts';
import {
  DefinitionEventSchema,
  type DefinitionContent,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { definitionChanged, definitionChangedBy } from './changed-resources.ts';
import { mostDescriptionCharacters } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

const definitionEventTypes: readonly RecordedDefinitionEvent['type'][] = [
  'definition_created',
  'definition_updated',
  'definition_retired',
];

function contentShown({
  source,
  overview,
  description,
  input_schema,
  output_schema,
  warnings = [],
}: DefinitionContent) {
  return {
    source_bytes: Buffer.byteLength(source, 'utf8'),
    ...(overview === undefined ? {} : { overview_bytes: Buffer.byteLength(overview, 'utf8') }),
    ...(description === undefined ? {} : { description: firstCharacters(description, mostDescriptionCharacters) }),
    ...(input_schema === undefined ? {} : { input_schema_bytes: jsonBytesOf(input_schema) }),
    ...(output_schema === undefined ? {} : { output_schema_bytes: jsonBytesOf(output_schema) }),
    warning_count: warnings.length,
  };
}

function accountOf(words: DefinitionWords, event: RecordedDefinitionEvent, definitionType: string): Account {
  const { definitionName: name, definitionVersion: version } = event.context;
  if (event.type === 'definition_retired') {
    return { summary: definitionRetired(words, definitionType, name), data: {} };
  }
  return {
    summary:
      event.type === 'definition_created'
        ? definitionCreated(words, definitionType, name)
        : definitionUpdated(words, definitionType, name, version),
    data: contentShown(event.data.content),
  };
}

export function definitionPresenter(words: DefinitionWords): Presenter {
  return eventPresenter<RecordedDefinitionEvent>({
    streamKind: 'definitions',
    eventSchema: DefinitionEventSchema,
    types: definitionEventTypes,
    account: (event, definitionType) => accountOf(words, event, definitionType),
    changes: changingOne(definitionChanged, definitionEventTypes, definitionChangedBy),
  });
}
