import type { Decider } from '@on.auto/operations';
import { Result } from 'effect';

import type { DefinitionCommand } from './definition-commands.ts';
import { DefinitionEventSchema, type RecordedDefinitionEvent } from './definition-events.ts';
import { evolveRegistry, initialRegistry, type DefinitionRegistry } from './definition-registry.ts';
import { decideOnDefinitions, definitionContextOf } from './registry-decisions.ts';
import { presentedAlready, type SubjectOf } from './subject-words.ts';

export function definitionsDecider(
  type: string,
  mostActive = Number.POSITIVE_INFINITY,
  subjectOf?: SubjectOf,
): Decider<DefinitionRegistry, DefinitionCommand, RecordedDefinitionEvent, 'not_found' | 'conflict'> {
  return {
    initialState: initialRegistry,
    evolve: evolveRegistry,
    decide: (command, registry) => {
      const presented = subjectOf === undefined ? undefined : presentedAlready(subjectOf, command, registry);
      return presented === undefined
        ? decideOnDefinitions({ type, mostActive }, command, registry)
        : Result.fail(presented);
    },
    context: (command, registry) => definitionContextOf(type, command, registry),
    eventSchema: DefinitionEventSchema,
  };
}

export function definitionTypeStreamOf(type: string): string {
  return `definitions/${type}`;
}
