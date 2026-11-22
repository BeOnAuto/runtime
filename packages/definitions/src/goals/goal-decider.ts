import {
  Conflict,
  InvalidInput,
  type Context,
  type Decided,
  type Decider,
  type Fold,
  type RecordedCaller,
} from '@on.auto/operations';
import { Result } from 'effect';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { agentIssue, changedSince, notReplacing, retiredWords, type GoalIssue } from './goal-issues.ts';
import { isCalendarWindow, type Goal } from './goals-document.ts';
import { GoalEventSchema, type RecordedGoalEvent } from './goals-facts.ts';

export const goalStream = 'goals/goal';

export interface StandingYes {
  readonly version: number;
  readonly at: string;
  readonly by: string;
  readonly content: Goal;
}

export interface GoalState {
  readonly definition: string;
  readonly playbook: string;
  readonly name: string;
  readonly position: number;
  readonly goal: Goal;
  readonly version: number;
  readonly agreed?: StandingYes;
  readonly removed: boolean;
}

interface Acting {
  readonly playbook: string;
  readonly by: string;
  readonly at: string;
}

interface GoalSaving extends Acting {
  readonly type: 'save';
  readonly goal: Goal;
  readonly position: number;
}

interface GoalRemoval extends Acting {
  readonly type: 'remove';
}

interface GoalAgreeing extends Acting {
  readonly type: 'agree';
  readonly seen: readonly number[];
}

interface GoalRenaming extends Acting {
  readonly type: 'rename';
  readonly from: string;
  readonly to: string;
  readonly renamed_by: RecordedCaller;
}

interface GoalMoving extends Acting {
  readonly type: 'move';
  readonly to: string;
  readonly moved_by: RecordedCaller;
  readonly position: number;
  readonly expectedVersion: number;
}

export type GoalCommand = GoalSaving | GoalRemoval | GoalAgreeing | GoalRenaming | GoalMoving;

type Rejected = InvalidInput | Conflict;

type Decision = Result.Result<readonly Decided<RecordedGoalEvent>[], Rejected>;

const defaultTimeZone = 'UTC';

interface ShapePart {
  readonly key: string;
  readonly words: string;
  readonly of: (goal: Goal) => string;
}

function windowKindOf({ window }: Goal): string {
  if (window === undefined) {
    return 'none';
  }
  return isCalendarWindow(window) ? 'calendar' : 'after';
}

function calendarOf({ window }: Goal): string {
  return window !== undefined && isCalendarWindow(window) ? window.calendar : '';
}

function timeZoneOf({ window }: Goal): string {
  return window !== undefined && isCalendarWindow(window) ? (window.time_zone ?? defaultTimeZone) : '';
}

const shapeParts: readonly ShapePart[] = [
  { key: 'per', words: 'what it is judged per', of: ({ per }) => per ?? '' },
  { key: 'window', words: 'the kind of its window', of: windowKindOf },
  { key: 'window/calendar', words: 'the unit of its calendar window', of: calendarOf },
  { key: 'window/time_zone', words: 'the time zone of its window', of: timeZoneOf },
  { key: 'success/settles', words: 'how it settles', of: ({ success }) => success.settles },
];

function shapeIssuesOf(held: Goal, { goal, position }: GoalSaving): readonly GoalIssue[] {
  return shapeParts
    .filter(({ of }) => of(held) !== of(goal))
    .map(({ key, words }) =>
      agentIssue(
        `/${String(position)}/${key}`,
        `The goal ${goal.id} cannot change ${words} once saved; give a goal of another shape a new id`,
      ),
    );
}

function sortedOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((each: unknown) => sortedOf(each));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted((left: readonly [string, unknown], right: readonly [string, unknown]) =>
        left[0].localeCompare(right[0]),
      )
      .map(([key, each]: readonly [string, unknown]) => [key, sortedOf(each)]),
  );
}

function canonicalOf(goal: Goal, leftOut: ReadonlySet<string> = new Set()): string {
  const kept = Object.entries(goal).filter((entry: readonly [string, unknown]) => !leftOut.has(entry[0]));
  return JSON.stringify(sortedOf(Object.fromEntries(kept)));
}

const whatAYesLeavesOut: ReadonlySet<string> = new Set(['id', 'retired']);

export function isSameContent(saved: Goal, agreed: Goal): boolean {
  return canonicalOf(saved, whatAYesLeavesOut) === canonicalOf(agreed, whatAYesLeavesOut);
}

export function standingYesOf({ goal, agreed }: GoalState): StandingYes | undefined {
  return agreed !== undefined && isSameContent(goal, agreed.content) ? agreed : undefined;
}

export function isRetired({ goal }: Pick<GoalState, 'goal'>): boolean {
  return goal.retired === true;
}

export const theIdItHas = '`new_id` is the id it has; give another id';

export function noGoalWithTheId(id: string): string {
  return `This playbook has no goal with the id ${id}`;
}

export function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

function isHeldIn(state: GoalState | undefined, playbook: string): state is GoalState {
  return state !== undefined && !state.removed && state.playbook === playbook;
}

function decidedSave(saving: GoalSaving, state: GoalState | undefined): Decision {
  const { playbook, position, goal } = saving;
  if (state === undefined) {
    return Result.succeed([{ type: 'goal_created', data: { playbook, position, goal } }]);
  }
  if (!isHeldIn(state, playbook) || state.name !== goal.id) {
    return Result.fail(changedMeanwhile);
  }
  const issues = shapeIssuesOf(state.goal, saving);
  if (issues.length > 0) {
    return Result.fail(notReplacing(issues));
  }
  return Result.succeed([
    ...(canonicalOf(state.goal) === canonicalOf(goal) ? [] : [{ type: 'goal_updated' as const, data: { goal } }]),
    ...(state.position === position ? [] : [{ type: 'goal_reordered' as const, data: { position } }]),
  ]);
}

function decidedRemoval({ playbook }: GoalRemoval, state: GoalState | undefined): Decision {
  return isHeldIn(state, playbook) ? Result.succeed([{ type: 'goal_removed', data: {} }]) : Result.succeed([]);
}

function decidedYes({ playbook, seen }: GoalAgreeing, state: GoalState | undefined): Decision {
  if (!isHeldIn(state, playbook)) {
    return Result.fail(changedMeanwhile);
  }
  const stale = seen.find((version) => version !== state.version);
  if (stale !== undefined) {
    return Result.fail(new Conflict({ detail: changedSince(state.name, stale, state.version) }));
  }
  if (isRetired(state)) {
    return Result.fail(new InvalidInput({ detail: retiredWords(state.name), issues: [] }));
  }
  return standingYesOf(state) === undefined
    ? Result.succeed([{ type: 'goal_agreed', data: { version: state.version } }])
    : Result.succeed([]);
}

function decidedMove(moving: GoalMoving, state: GoalState | undefined): Decision {
  const { playbook, to, moved_by: movedBy, position, expectedVersion } = moving;
  return isHeldIn(state, playbook) && state.version === expectedVersion
    ? Result.succeed([{ type: 'goal_moved', data: { from: playbook, to, moved_by: movedBy, position } }])
    : Result.fail(changedMeanwhile);
}

function decidedRename(
  { playbook, from, to, renamed_by: renamedBy }: GoalRenaming,
  state: GoalState | undefined,
): Decision {
  if (!isHeldIn(state, playbook) || state.name !== from) {
    return Result.fail(refusedAt('/rename_goal/id', noGoalWithTheId(from)));
  }
  return to === from
    ? Result.fail(refusedAt('/rename_goal/new_id', theIdItHas))
    : Result.succeed([{ type: 'goal_renamed', data: { from, to, renamed_by: renamedBy } }]);
}

export function decidedOnAGoal(command: GoalCommand, state: GoalState | undefined): Decision {
  if (command.type === 'save') {
    return decidedSave(command, state);
  }
  if (command.type === 'move') {
    return decidedMove(command, state);
  }
  if (command.type === 'remove') {
    return decidedRemoval(command, state);
  }
  return command.type === 'agree' ? decidedYes(command, state) : decidedRename(command, state);
}

function createdBy(definition: string, fact: Extract<RecordedGoalEvent, { type: 'goal_created' }>): GoalState {
  const { playbook, position, goal } = fact.data;
  return { definition, playbook, name: goal.id, position, goal, version: 1, removed: false };
}

function heldAfter(held: GoalState, fact: Exclude<RecordedGoalEvent, { type: 'goal_created' }>): GoalState {
  if (fact.type === 'goal_updated') {
    return { ...held, goal: { ...fact.data.goal, id: held.name }, version: held.version + 1 };
  }
  if (fact.type === 'goal_reordered') {
    return { ...held, position: fact.data.position };
  }
  if (fact.type === 'goal_agreed') {
    const { at, by } = fact.context;
    return { ...held, agreed: { version: fact.data.version, at, by, content: held.goal } };
  }
  if (fact.type === 'goal_renamed') {
    const { to } = fact.data;
    return { ...held, name: to, goal: { ...held.goal, id: to } };
  }
  if (fact.type === 'goal_moved') {
    return { ...held, playbook: fact.data.to, position: fact.data.position };
  }
  return { ...held, removed: true };
}

function evolvedIn(definition: string) {
  return (state: GoalState | undefined, fact: RecordedGoalEvent): GoalState | undefined => {
    if (fact.type === 'goal_created') {
      return createdBy(definition, fact);
    }
    return state === undefined ? undefined : heldAfter(state, fact);
  };
}

export function goalFoldOf(definition: string): Fold<GoalState | undefined, RecordedGoalEvent> {
  return { initialState: undefined, evolve: evolvedIn(definition), eventSchema: GoalEventSchema };
}

export function goalDecider(
  definition: string,
): Decider<GoalState | undefined, GoalCommand, RecordedGoalEvent, 'invalid_input' | 'conflict'> {
  return {
    ...goalFoldOf(definition),
    decide: decidedOnAGoal,
    context: ({ by, at }): Context => ({ at, by, definitionId: definition }),
  };
}
