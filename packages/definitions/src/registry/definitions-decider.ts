import type { Decider } from '@on.auto/operations';

import type { DefinitionCommand } from './definition-commands.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from './definition-events.ts';
import { evolveRegistry, initialRegistry, type DefinitionRegistry } from './definition-registry.ts';
import { decideOnDefinitions, definitionContextOf } from './registry-decisions.ts';

export function definitionsDecider(
  type: string,
  mostActive = Number.POSITIVE_INFINITY,
): Decider<DefinitionRegistry, DefinitionCommand, RecordedDefinitionEvent, 'not_found' | 'conflict'> {
  return {
    initialState: initialRegistry,
    evolve: evolveRegistry,
    decide: (command, registry) => decideOnDefinitions({ type, mostActive }, command, registry),
    context: (command, registry) => definitionContextOf(type, command, registry),
    eventSchema: DefinitionEventSchema,
  };
}

export function definitionTypeStreamOf(type: string): string {
  return `definitions/${type}`;
}
