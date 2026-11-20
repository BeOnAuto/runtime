import { recordedDecoder, streamPrefixOfPlaybook } from '@on.auto/operations';
import type {
  DefinitionName,
  DefinitionNames,
  NameAfter,
  NameBound,
  NamedMessage,
} from '@on.auto/operations/definition-names';
import { Option } from 'effect';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { goalStream } from './goal-decider.ts';
import { mostGoals, type Goal } from './goals-document.ts';
import { GoalEventSchema, type RecordedGoalEvent } from './goals-facts.ts';

export const goalType = 'goal';

const aGoalStream = new RegExp(`^(definition/([^/]+)/[^/]+/)${goalStream}$`, 'u');

interface GoalPlace {
  readonly definitionKey: string;
  readonly org: string;
}

function goalStreamOf(stream: string): GoalPlace | undefined {
  const [, definitionKey, org] = aGoalStream.exec(stream) ?? [];
  return definitionKey === undefined || org === undefined ? undefined : { definitionKey, org };
}

const decodeFact = recordedDecoder(GoalEventSchema);

function goalFactOf(message: NamedMessage): RecordedGoalEvent | undefined {
  return Option.getOrUndefined(decodeFact(message));
}

function statusOf({ retired }: Goal): string {
  return retired === true ? 'retired' : 'active';
}

function createdName({ org }: GoalPlace, { playbook, goal }: { readonly playbook: string; readonly goal: Goal }) {
  return {
    playbookKey: streamPrefixOfPlaybook({ org, playbook }),
    definitionType: goalType,
    name: goal.id,
    status: statusOf(goal),
    hasTriggers: false,
  };
}

function nameChangedBy(held: DefinitionName, fact: RecordedGoalEvent): NameAfter {
  if (fact.type === 'goal_removed') {
    return 'released';
  }
  const status = fact.type === 'goal_updated' ? statusOf(fact.data.goal) : held.status;
  return status === held.status ? undefined : { ...held, status };
}

function nameAfter(held: DefinitionName | undefined, message: NamedMessage): NameAfter {
  const place = goalStreamOf(message.stream);
  const fact = goalFactOf(message);
  if (place === undefined || fact === undefined) {
    return undefined;
  }
  if (fact.type === 'goal_created') {
    return createdName(place, fact.data);
  }
  return held === undefined ? undefined : nameChangedBy(held, fact);
}

export const mostGoalsAPlaybookKeeps: NameBound = {
  checkedBy: ['goal_created'],
  counts: () => true,
  most: (definitionType) => (definitionType === goalType ? mostGoals : Number.POSITIVE_INFINITY),
  beyond: () => changedMeanwhile,
};

export const goalNames: DefinitionNames = {
  types: ['goal_created', 'goal_updated', 'goal_removed'],
  holdsNames: (stream) => goalStreamOf(stream) !== undefined,
  definitionKeyOf: ({ stream }) => goalStreamOf(stream)?.definitionKey,
  nameAfter,
  takenBy: () => changedMeanwhile,
  bounds: [mostGoalsAPlaybookKeeps],
};
