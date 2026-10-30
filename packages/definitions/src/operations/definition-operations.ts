import type { Presenter, Registration, RouteRegistration } from '@on.auto/operations';

import type { Capability } from '../capability/capability.ts';
import { runOperations } from '../reading/run-operations.ts';
import type { CapabilityFacts } from '../run-work/declared-facts.ts';
import { defineCreateDefinition } from './create-definition.ts';
import { defineGetDefinition } from './get-definition.ts';
import { defineListDefinitions } from './list-definitions.ts';
import { defineRetireDefinition } from './retire-definition.ts';
import { defineRunDefinition } from './run-definition.ts';
import { defineUpdateDefinition } from './update-definition.ts';

export interface PlaybookOperation {
  readonly registration: Registration<'playbook'>;
}

interface ServedOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function makeDefinitionOperations(
  capabilities: readonly Capability[],
  facts?: CapabilityFacts,
  presenters?: readonly Presenter[],
): readonly ServedOperation[] {
  return [
    defineCreateDefinition(capabilities),
    defineListDefinitions(capabilities),
    defineGetDefinition(capabilities),
    defineUpdateDefinition(capabilities),
    defineRetireDefinition(capabilities),
    defineRunDefinition(capabilities),
    ...runOperations(capabilities, facts, presenters),
  ];
}
