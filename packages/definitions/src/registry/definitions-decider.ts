import type { Decider, Fold, PlaybookAddress } from '@on.auto/operations';

import type { DefinitionCommand } from './definition-commands.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from './definition-events.ts';
import { definitionEvolvedIn, type DefinitionState } from './definition-registry.ts';
import { decideOnDefinition, definitionContextOf } from './registry-decisions.ts';

export function definitionFoldOf(definition: string): Fold<DefinitionState, RecordedDefinitionEvent> {
  return { initialState: undefined, evolve: definitionEvolvedIn(definition), eventSchema: DefinitionEventSchema };
}

export function definitionDecider(
  type: string,
  address: PlaybookAddress,
  definition: string,
): Decider<DefinitionState, DefinitionCommand, RecordedDefinitionEvent, 'not_found' | 'conflict'> {
  const of = { type, address, definition };
  return {
    ...definitionFoldOf(definition),
    decide: (command, existing) => decideOnDefinition(of, command, existing),
    context: (command, existing) => definitionContextOf(of, command, existing),
  };
}

export function definitionTypeStreamOf(type: string): string {
  return `definitions/${type}`;
}
