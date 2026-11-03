import type { Presenter, Registration, RouteRegistration } from '@on.auto/operations';

import type { Capability } from '../capability/capability.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { runOperations } from '../reading/run-operations.ts';
import type { CapabilityFacts } from '../run-work/declared-facts.ts';
import { operationsOnDefinitions } from './definition-catalog.ts';

export interface PlaybookOperation {
  readonly registration: Registration<'playbook'>;
}

interface ServedOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function makeDefinitionOperations(
  capabilities: readonly Capability[],
  pages: SubjectPages,
  facts?: CapabilityFacts,
  presenters?: readonly Presenter[],
): readonly ServedOperation[] {
  return [...operationsOnDefinitions(capabilities, pages), ...runOperations(capabilities, facts, presenters)];
}
