import { Buffer } from 'node:buffer';

import type { Presenter } from '@on.auto/operations';

import { firstCharacters } from '../plain-language/characters.ts';
import type { DefinitionWords } from '../plain-language/definition-words.ts';
import {
  definitionCreated,
  definitionPaused,
  definitionRestored,
  definitionResumed,
  definitionRetired,
  definitionUpdated,
} from '../plain-language/event-words.ts';
import {
  definitionFactTypes,
  type DefinitionContent,
  type DefinitionPaused,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { cutAtCodePoint, mostDescriptionCharacters, mostDetailBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';
import {
  DefinitionsStreamEventSchema,
  definitionsStreamChangesOf,
  playbookPageAccountOf,
  type DefinitionsStreamEvent,
} from './playbook-page-presenting.ts';

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

function pauseShown({ paused_by, reason }: DefinitionPaused['data']) {
  return { paused_by, ...(reason === undefined ? {} : { reason: cutAtCodePoint(reason, mostDetailBytes) }) };
}

function accountOf(words: DefinitionWords, event: RecordedDefinitionEvent, definitionType: string): Account {
  const { definitionName: name, definitionVersion: version } = event.context;
  if (event.type === 'definition_retired') {
    return { summary: definitionRetired(words, definitionType, name), data: {} };
  }
  if (event.type === 'definition_paused') {
    return { summary: definitionPaused(words, definitionType, name), data: pauseShown(event.data) };
  }
  if (event.type === 'definition_resumed') {
    return { summary: definitionResumed(words, definitionType, name), data: {} };
  }
  if (event.type === 'definition_restored') {
    return { summary: definitionRestored(words, definitionType, name), data: { restored_by: event.data.restored_by } };
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
  return eventPresenter<DefinitionsStreamEvent>({
    streamKind: 'definitions',
    eventSchema: DefinitionsStreamEventSchema,
    types: [...definitionFactTypes, 'playbook_page_saved'],
    account: (event, definitionType) =>
      event.type === 'playbook_page_saved' ? playbookPageAccountOf(event) : accountOf(words, event, definitionType),
    changes: definitionsStreamChangesOf(definitionFactTypes),
  });
}
