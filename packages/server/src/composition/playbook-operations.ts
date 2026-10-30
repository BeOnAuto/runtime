import {
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  type Capability,
} from '@on.auto/definitions';
import type { RouteRegistration } from '@on.auto/operations';
import { defineGetEvent, defineListPlaybookChanges, defineListPlaybookEvents } from '@on.auto/playbooks';

import type { ComposedFacts } from './composed-facts.ts';

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function playbookOperationsServing(
  capabilities: readonly Capability[],
  { facts, names }: Pick<ComposedFacts, 'facts' | 'names'>,
): readonly PlaybookOperation[] {
  const presenters = makeDefinitionPresenters(capabilities, facts);
  return [
    ...makeDefinitionOperations(capabilities, facts, presenters),
    defineListPlaybookEvents(presenters),
    defineListPlaybookChanges(presenters),
    defineGetEvent(presenters),
    definePublishEvent(names),
  ];
}
