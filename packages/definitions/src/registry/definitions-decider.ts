import type { Decider, Fold, PlaybookAddress } from '@on.auto/operations';

import type { DefinitionCommand } from './definition-commands.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from './definition-events.ts';
import { initialRegistry, registryEvolvedIn, type DefinitionRegistry } from './definition-registry.ts';
import { decideOnDefinition, definitionContextOf } from './registry-decisions.ts';

export function definitionsFoldIn(address: PlaybookAddress): Fold<DefinitionRegistry, RecordedDefinitionEvent> {
  return { initialState: initialRegistry, evolve: registryEvolvedIn(address), eventSchema: DefinitionEventSchema };
}

export function definitionsDecider(
  type: string,
  address: PlaybookAddress,
): Decider<DefinitionRegistry, DefinitionCommand, RecordedDefinitionEvent, 'not_found' | 'conflict'> {
  const of = { type, address };
  return {
    ...definitionsFoldIn(address),
    decide: (command, registry) => decideOnDefinition(of, command, registry.get(command.name)),
    context: (command, registry) => definitionContextOf(of, command, registry.get(command.name)),
  };
}

export function definitionTypeStreamOf(type: string): string {
  return `definitions/${type}`;
}
