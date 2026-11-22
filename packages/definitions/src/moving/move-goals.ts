import { Conflict, InvalidInput, PlaybookReader, type AdmittedPlaybook, type Issue } from '@on.auto/operations';
import { Effect } from 'effect';

import { contributesIn } from '../contributions/contributes-details.ts';
import { noGoalWithTheId } from '../goals/goal-decider.ts';
import { goalType } from '../goals/goal-names.ts';
import { goalStatesIn } from '../goals/playbook-goals.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { isOneOf, type Member } from './move-members.ts';
import {
  goalInUseWords,
  goalTakenWords,
  messagesThroughWords,
  noGoalWords,
  sentThroughByAGoalLeftWords,
  servesAGoalLeftWords,
} from './move-words.ts';

type GoalState = Effect.Success<typeof goalStatesIn>[number];

export interface MovingGoal {
  readonly state: GoalState;
  readonly position: number;
}

export interface GoalsOfAMove {
  readonly moving: readonly GoalState[];
  readonly held: readonly GoalState[];
}

const workflowType = 'workflow';

const interactionType = 'interaction';

const noGoalsMoving: GoalsOfAMove = { moving: [], held: [] };

function missingOf(ids: readonly string[], held: readonly GoalState[]): readonly Issue[] {
  return ids.flatMap((id, index) =>
    held.some(({ name }) => name === id) ? [] : [{ pointer: `/goals/${String(index)}`, detail: noGoalWithTheId(id) }],
  );
}

function missingRefusal(ids: readonly string[], held: readonly GoalState[]): InvalidInput | undefined {
  const missing = missingOf(ids, held);
  const first = ids.find((id) => !held.some(({ name }) => name === id));
  return first === undefined ? undefined : new InvalidInput({ detail: noGoalWords(first), issues: missing });
}

function namedIn(ids: readonly string[], held: readonly GoalState[]): readonly GoalState[] {
  return held
    .filter(({ name }) => ids.includes(name))
    .toSorted((one, other) => ids.indexOf(one.name) - ids.indexOf(other.name));
}

export function goalsNamed(ids: readonly string[]): Effect.Effect<GoalsOfAMove, InvalidInput, PlaybookReader> {
  if (ids.length === 0) {
    return Effect.succeed(noGoalsMoving);
  }
  return Effect.flatMap(goalStatesIn, (held) => {
    const refusal = missingRefusal(ids, held);
    return refusal === undefined ? Effect.succeed({ moving: namedIn(ids, held), held }) : Effect.fail(refusal);
  });
}

function servedBy({ details }: RegisteredDefinition): readonly string[] {
  return (contributesIn(details) ?? []).map(({ goal }) => goal);
}

function staying(type: string, names: readonly string[]) {
  return { definitions: names.map((name) => ({ type, name })) };
}

function inUseRefusal(
  { moving }: GoalsOfAMove,
  workflows: readonly RegisteredDefinition[],
  members: readonly Member[],
): Conflict | undefined {
  const isMember = isOneOf(members);
  const [refusal] = moving.flatMap(({ name }) => {
    const left = workflows
      .filter((stored) => servedBy(stored).includes(name) && !isMember({ type: workflowType, name: stored.name }))
      .map((stored) => stored.name);
    return left.length === 0
      ? []
      : [new Conflict({ detail: goalInUseWords(name, left), kind: 'in_use', record: staying(workflowType, left) })];
  });
  return refusal;
}

function leftOutRefusal({ moving, held }: GoalsOfAMove, members: readonly Member[]): Conflict | undefined {
  const moved = new Set(moving.map(({ name }) => name));
  const stays = new Set(held.map(({ name }) => name).filter((name) => !moved.has(name)));
  const [refusal] = members
    .filter(({ type }) => type === workflowType)
    .flatMap(({ name, stored }) => {
      const served = servedBy(stored);
      const others = [...new Set(served.filter((goal) => stays.has(goal)))];
      const [other] = others;
      return other === undefined || !served.some((goal) => moved.has(goal))
        ? []
        : [new Conflict({ detail: servesAGoalLeftWords(name, other), kind: 'incomplete', record: { goals: others } })];
    });
  return refusal;
}

function throughsOf({ goal }: GoalState): readonly string[] {
  const through = goal.notify?.through;
  return [...new Set([through, goal.notify?.summary?.through ?? through])].filter(
    (name): name is string => name !== undefined,
  );
}

function sentThroughThere(to: AdmittedPlaybook, through: string): Effect.Effect<boolean> {
  return Effect.map(
    to.reader.holderOfName(interactionType, through),
    (holder) => holder !== undefined && holder.status !== 'retired',
  );
}

interface SentThrough {
  readonly id: string;
  readonly through: string;
}

function messagesRefused(
  to: AdmittedPlaybook,
  { moving }: GoalsOfAMove,
  members: readonly Member[],
): Effect.Effect<void, Conflict> {
  const isMember = isOneOf(members);
  const needed = moving.flatMap((state) =>
    throughsOf(state).map((through): SentThrough => ({ id: state.name, through })),
  );
  return Effect.forEach(
    needed.filter(({ through }) => !isMember({ type: interactionType, name: through })),
    ({ id, through }) =>
      Effect.flatMap(sentThroughThere(to, through), (there) =>
        there
          ? Effect.void
          : Effect.fail(
              new Conflict({
                detail: messagesThroughWords(id, through, to.address.playbook),
                kind: 'incomplete',
                record: staying(interactionType, [through]),
              }),
            ),
      ),
    { discard: true },
  );
}

function functionLeftRefusal({ moving, held }: GoalsOfAMove, members: readonly Member[], to: string) {
  const moved = new Set(moving.map(({ name }) => name));
  const functions = new Set(members.filter(({ type }) => type === interactionType).map(({ name }) => name));
  const [refusal] = held
    .filter(({ name }) => !moved.has(name))
    .flatMap((state) =>
      throughsOf(state)
        .filter((through) => functions.has(through))
        .map(
          (through) =>
            new Conflict({
              detail: sentThroughByAGoalLeftWords(state.name, through, to),
              kind: 'in_use',
              record: { goals: [state.name] },
            }),
        ),
    );
  return refusal;
}

interface GoalRules {
  readonly messages: boolean;
}

export function goalRulesRefused(
  { messages }: GoalRules,
  to: AdmittedPlaybook,
  goals: GoalsOfAMove,
  members: readonly Member[],
): Effect.Effect<void, Conflict, PlaybookReader> {
  if (goals.moving.length === 0) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    const workflows = [...(yield* loadRegistry(workflowType)).values()].filter(({ status }) => status !== 'retired');
    const refusal = inUseRefusal(goals, workflows, members) ?? leftOutRefusal(goals, members);
    yield* refusal === undefined ? Effect.void : Effect.fail(refusal);
    if (messages) {
      const left = functionLeftRefusal(goals, members, to.address.playbook);
      yield* left === undefined ? Effect.void : Effect.fail(left);
      yield* messagesRefused(to, goals, members);
    }
  });
}

export function goalsTakenRefused(to: AdmittedPlaybook, { moving }: GoalsOfAMove): Effect.Effect<void, Conflict> {
  return Effect.forEach(
    moving,
    ({ name }) =>
      Effect.flatMap(to.reader.holderOfName(goalType, name), (holder) =>
        holder === undefined
          ? Effect.void
          : Effect.fail(
              new Conflict({
                detail: goalTakenWords(to.address.playbook, name, holder.status === 'retired'),
                kind: 'taken',
              }),
            ),
      ),
    { discard: true },
  );
}

export function placedThere(to: AdmittedPlaybook, { moving }: GoalsOfAMove): Effect.Effect<readonly MovingGoal[]> {
  if (moving.length === 0) {
    return Effect.succeed([]);
  }
  return Effect.map(Effect.provideService(goalStatesIn, PlaybookReader, to.reader), (there) => {
    const next = Math.max(-1, ...there.map(({ position }) => position)) + 1;
    return moving.map((state, index) => ({ state, position: next + index }));
  });
}
