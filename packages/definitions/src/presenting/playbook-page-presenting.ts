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

const [created, updated, retired, paused, resumed, restored] = DefinitionEventSchema.members;

export const DefinitionsStreamEventSchema = Schema.Union([
  created,
  updated,
  retired,
  paused,
  resumed,
  restored,
  ...PageEventSchema.members,
]);

export type DefinitionsStreamEvent = typeof DefinitionsStreamEventSchema.Type;

export function isPresented(
  type: RecordedDefinitionEvent['type'],
): type is Extract<DefinitionsStreamEvent['type'], RecordedDefinitionEvent['type']> {
  return type !== 'definition_moved';
}

export function definitionsStreamChangesOf(definitionTypes: readonly string[]): ChangesNamed {
  return {
    kinds: [definitionChanged, playbookChanged],
    named: {
      ...Object.fromEntries(definitionTypes.map((type) => [type, definitionChangedBy])),
      playbook_page_saved: playbookChangedBy,
    },
  };
}
