import type { Presenter } from '@on.auto/operations';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import {
  definitionCreated,
  definitionPaused,
  definitionRestored,
  definitionResumed,
  definitionRetired,
  definitionUpdated,
} from '../plain-language/event-words.ts';
import { definitionFactTypes, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { contentShown, pauseShown } from './definition-content-shown.ts';
import { eventPresenter, type Account } from './event-presenter.ts';
import {
  DefinitionsStreamEventSchema,
  definitionsStreamChangesOf,
  playbookPageAccountOf,
  type DefinitionsStreamEvent,
} from './playbook-page-presenting.ts';

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
