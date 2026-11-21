import type { Decider } from '@on.auto/operations';
import { Schema } from 'effect';

import { DefinitionEventSchema, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { GoalEventSchema, type RecordedGoalEvent } from './goals-facts.ts';

export const GoalOrDefinitionEventSchema = Schema.Union([GoalEventSchema, DefinitionEventSchema]);

type RecordedGoalOrDefinitionEvent = typeof GoalOrDefinitionEventSchema.Type;

type GoalOrDefinition<OfTheGoal, OfADefinition> = { readonly goal: OfTheGoal } | { readonly definition: OfADefinition };

type RefusedOnAGoal = 'invalid_input' | 'conflict';

type RefusedOnADefinition = 'not_found' | 'conflict';

type Refused = RefusedOnAGoal | RefusedOnADefinition;

interface DecisionOn<State, Command, Event extends RecordedGoalOrDefinitionEvent, R extends Refused> {
  readonly definition: string;
  readonly stream: string;
  readonly decider: Decider<State, Command, Event, R>;
  readonly command: Command;
}

type Sided<GoalState, GoalCommand, State, Command> = Decider<
  GoalOrDefinition<GoalState, State>,
  GoalOrDefinition<GoalCommand, Command>,
  RecordedGoalOrDefinitionEvent,
  Refused
>;

const isAGoalFact = Schema.is(GoalEventSchema);

function theGoalOf<OfTheGoal, OfADefinition>(held: GoalOrDefinition<OfTheGoal, OfADefinition>): OfTheGoal {
  if ('goal' in held) {
    return held.goal;
  }
  throw new TypeError('A decision on a goal was handed what a definition holds');
}

function theDefinitionOf<OfTheGoal, OfADefinition>(held: GoalOrDefinition<OfTheGoal, OfADefinition>): OfADefinition {
  if ('definition' in held) {
    return held.definition;
  }
  throw new TypeError('A decision on a definition was handed what a goal holds');
}

function onTheGoal<GoalState, GoalCommand, State, Command>(
  decider: Decider<GoalState, GoalCommand, RecordedGoalEvent, RefusedOnAGoal>,
): Sided<GoalState, GoalCommand, State, Command> {
  return {
    initialState: { goal: decider.initialState },
    eventSchema: GoalOrDefinitionEventSchema,
    evolve: (held, fact) => (isAGoalFact(fact) ? { goal: decider.evolve(theGoalOf(held), fact) } : held),
    decide: (command, held) => decider.decide(theGoalOf(command), theGoalOf(held)),
    context: (command, held) => decider.context(theGoalOf(command), theGoalOf(held)),
  };
}

function onADefinition<GoalState, GoalCommand, State, Command>(
  decider: Decider<State, Command, RecordedDefinitionEvent, RefusedOnADefinition>,
): Sided<GoalState, GoalCommand, State, Command> {
  return {
    initialState: { definition: decider.initialState },
    eventSchema: GoalOrDefinitionEventSchema,
    evolve: (held, fact) => (isAGoalFact(fact) ? held : { definition: decider.evolve(theDefinitionOf(held), fact) }),
    decide: (command, held) => decider.decide(theDefinitionOf(command), theDefinitionOf(held)),
    context: (command, held) => decider.context(theDefinitionOf(command), theDefinitionOf(held)),
  };
}

export function decisionsOnGoalsAndDefinitions<GoalState, GoalCommand, State, Command>(
  goals: readonly DecisionOn<GoalState, GoalCommand, RecordedGoalEvent, RefusedOnAGoal>[],
  definitions: readonly DecisionOn<State, Command, RecordedDefinitionEvent, RefusedOnADefinition>[],
): readonly DecisionOn<
  GoalOrDefinition<GoalState, State>,
  GoalOrDefinition<GoalCommand, Command>,
  RecordedGoalOrDefinitionEvent,
  Refused
>[] {
  return [
    ...goals.map(({ definition, stream, decider, command }) => ({
      definition,
      stream,
      decider: onTheGoal<GoalState, GoalCommand, State, Command>(decider),
      command: { goal: command },
    })),
    ...definitions.map(({ definition, stream, decider, command }) => ({
      definition,
      stream,
      decider: onADefinition<GoalState, GoalCommand, State, Command>(decider),
      command: { definition: command },
    })),
  ];
}
