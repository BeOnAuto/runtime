import { Conflict, type Context, type Decider, type RecordedCaller, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import {
  DefinitionEventSchema,
  type DefinitionEvent,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { definitionEvolvedIn, type DefinitionState } from '../registry/definition-registry.ts';
import { isRetired } from '../registry/definition.ts';
import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { definitionNotFound } from '../registry/registry-lookup.ts';
import { retiredWords } from './move-words.ts';

interface DefinitionPlacement {
  readonly definition: DefinitionState;
  readonly playbook: string | undefined;
}

interface DefinitionMove {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly moved_by: RecordedCaller;
  readonly expectedVersion: number;
  readonly by: string;
  readonly at: string;
}

const unplaced: DefinitionPlacement = { definition: undefined, playbook: undefined };

function playbookAfter(playbook: string | undefined, event: RecordedDefinitionEvent): string | undefined {
  if (event.type === 'definition_created') {
    return event.data.playbook;
  }
  return event.type === 'definition_moved' ? event.data.to : playbook;
}

function placedAfter(
  definition: string,
): (placed: DefinitionPlacement, event: RecordedDefinitionEvent) => DefinitionPlacement {
  const evolved = definitionEvolvedIn(definition);
  return (placed, event) => ({
    definition: evolved(placed.definition, event),
    playbook: playbookAfter(placed.playbook, event),
  });
}

export function retiredRefusal(type: string, name: string): Conflict {
  return new Conflict({ detail: retiredWords({ type, name }), kind: 'retired' });
}

type Decision = Result.Result<readonly DefinitionEvent[], Rejection<'not_found' | 'conflict'>>;

function decidedMove(
  type: string,
  { name, from, to, moved_by: movedBy, expectedVersion }: DefinitionMove,
  { definition, playbook }: DefinitionPlacement,
): Decision {
  if (definition === undefined || playbook !== from) {
    return Result.fail(definitionNotFound(type, name));
  }
  if (isRetired(definition)) {
    return Result.fail(retiredRefusal(type, name));
  }
  return definition.version === expectedVersion
    ? Result.succeed([{ type: 'definition_moved', data: { from, to, moved_by: movedBy } }])
    : Result.fail(changedMeanwhile);
}

function contextOfTheMove(type: string, definition: string) {
  return ({ name, by, at }: DefinitionMove, placed: DefinitionPlacement): Context => ({
    at,
    by,
    definitionType: type,
    definitionName: name,
    ...(placed.definition === undefined ? {} : { definitionVersion: placed.definition.version }),
    definitionId: definition,
  });
}

export function moveDecider(
  type: string,
  definition: string,
): Decider<DefinitionPlacement, DefinitionMove, RecordedDefinitionEvent, 'not_found' | 'conflict'> {
  return {
    initialState: unplaced,
    evolve: placedAfter(definition),
    eventSchema: DefinitionEventSchema,
    decide: (command, placed) => decidedMove(type, command, placed),
    context: contextOfTheMove(type, definition),
  };
}
