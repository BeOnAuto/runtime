import { commentChanges, commentOperations } from '@on.auto/activity';
import {
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  inTheDirectoryListing,
  type Capability,
} from '@on.auto/definitions';
import type { SubjectPages } from '@on.auto/definitions/page';
import type { RouteRegistration } from '@on.auto/operations';
import { defineGetEvent, defineListPlaybookChanges, defineListPlaybookEvents } from '@on.auto/playbooks';

import { directoryFactsOf, type ComposedFacts } from './composed-facts.ts';

export interface ServedPages {
  readonly pages: SubjectPages;
}

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function playbookOperationsServing(
  capabilities: readonly Capability[],
  { facts, names, pages }: Pick<ComposedFacts, 'facts' | 'names'> & ServedPages,
): readonly PlaybookOperation[] {
  const presenters = makeDefinitionPresenters(capabilities, facts);
  return [
    ...makeDefinitionOperations(capabilities, pages, facts, presenters),
    defineListPlaybookEvents(presenters),
    defineListPlaybookChanges(presenters, [commentChanges]),
    defineGetEvent(presenters),
    definePublishEvent(names),
    ...commentOperations,
  ];
}

interface DeclaredAndServed extends ServedPages {
  readonly capabilities: readonly Capability[];
}

export function directoryOperationsServing(
  capabilities: readonly Capability[],
  { capabilities: declared, pages }: DeclaredAndServed,
): readonly PlaybookOperation[] {
  return playbookOperationsServing(inTheDirectoryListing(capabilities), { ...directoryFactsOf(declared), pages });
}
