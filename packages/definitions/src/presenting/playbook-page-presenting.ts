import { Buffer } from 'node:buffer';

import type { ChangesNamed } from '@on.auto/operations';
import { Schema } from 'effect';

import { PageEventSchema, type RecordedPageEvent } from '../page/page-facts.ts';
import { playbookPageRemoved, playbookPageSaved } from '../plain-language/event-words.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { definitionChanged, definitionChangedBy, playbookChanged, playbookChangedBy } from './changed-resources.ts';
import type { Account } from './event-presenter.ts';

export function playbookPageAccountOf({ data: { page } }: RecordedPageEvent): Account {
  return page === null
    ? { summary: playbookPageRemoved(), data: {} }
    : { summary: playbookPageSaved(), data: { source_bytes: Buffer.byteLength(page.source, 'utf8') } };
}

export type DefinitionsStreamEvent = RecordedDefinitionEvent | RecordedPageEvent;

export const DefinitionsStreamEventSchema = Schema.Union([
  ...DefinitionEventSchema.members,
  ...PageEventSchema.members,
]);

export function definitionsStreamChangesOf(definitionTypes: readonly string[]): ChangesNamed {
  return {
    kinds: [definitionChanged, playbookChanged],
    named: {
      ...Object.fromEntries(definitionTypes.map((type) => [type, definitionChangedBy])),
      playbook_page_saved: playbookChangedBy,
    },
  };
}
