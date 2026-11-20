import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { goalsDocumentOfTheExamples } from '../testing/goals-book.ts';
import { decidedOnAGoal, goalFoldOf, isSameContent, type GoalCommand, type GoalState } from './goal-decider.ts';
import { controls, experiments } from './goal-examples.ts';
import type { Goal } from './goals-document.ts';
import type { RecordedGoalEvent } from './goals-facts.ts';
import { playbookGoalsOf } from './playbook-goals.ts';

const someWords: unknown = expect.any(String);

const theGoal: Goal = Option.getOrThrow(Option.fromNullishOr(goalsDocumentOfTheExamples([experiments]).goals[0]));

const held: GoalState = {
  definition: 'goal-1',
  playbook: 'alpha',
  name: experiments.id,
  position: 0,
  goal: theGoal,
  version: 3,
  removed: false,
};

const acting = { playbook: 'alpha', by: 'person:user_2ada', at: '2026-11-20T10:00:00.000Z' };

describe("a goal's decisions", () => {
  it('refuse a save of a goal no longer held in the playbook, or one the list names by another id, as changed meanwhile', () => {
    const save: GoalCommand = { type: 'save', goal: theGoal, position: 0, ...acting };

    expect([
      decidedOnAGoal(save, { ...held, removed: true }),
      decidedOnAGoal(save, { ...held, playbook: 'beta' }),
      decidedOnAGoal({ ...save, goal: { ...theGoal, id: 'another-id' } }, held),
    ]).toEqual([Result.fail(changedMeanwhile), Result.fail(changedMeanwhile), Result.fail(changedMeanwhile)]);
  });

  it('remove a goal held in the playbook, and nothing of one already gone', () => {
    const remove: GoalCommand = { type: 'remove', ...acting };

    expect([
      decidedOnAGoal(remove, held),
      decidedOnAGoal(remove, goalFoldOf('goal-1').initialState),
      decidedOnAGoal(remove, { ...held, removed: true }),
    ]).toEqual([Result.succeed([{ type: 'goal_removed', data: {} }]), Result.succeed([]), Result.succeed([])]);
  });

  it('record a yes at the version held, refuse one at another version or for a goal gone or retired, and record nothing for a yes that stands', () => {
    const agree: GoalCommand = { type: 'agree', seen: [3], ...acting };
    const agreed = { version: 3, at: acting.at, by: acting.by, content: theGoal };

    expect([
      decidedOnAGoal(agree, held),
      decidedOnAGoal({ ...agree, seen: [3, 2] }, held),
      decidedOnAGoal(agree, goalFoldOf('goal-1').initialState),
      decidedOnAGoal(agree, { ...held, goal: { ...theGoal, retired: true } }),
      decidedOnAGoal(agree, { ...held, agreed }),
    ]).toEqual([
      Result.succeed([{ type: 'goal_agreed', data: { version: 3 } }]),
      Result.fail(expect.objectContaining({ _tag: 'conflict', detail: someWords })),
      Result.fail(changedMeanwhile),
      Result.fail(expect.objectContaining({ _tag: 'invalid_input', detail: someWords, issues: [] })),
      Result.succeed([]),
    ]);
  });
});

describe("a goal's record, read", () => {
  it('folds a stream whose first fact is not its creation to no goal', () => {
    const fold = goalFoldOf('goal-1');
    const reordered: RecordedGoalEvent = {
      type: 'goal_reordered',
      data: { position: 1 },
      context: { at: acting.at, by: acting.by, definitionId: 'goal-1' },
    };

    expect(fold.evolve(fold.initialState, reordered)).toBeUndefined();
  });

  it('orders goals that share a place, as two saves at once can leave them, by their ids', () => {
    const second = { ...held, definition: 'goal-0', name: controls.id, goal: { ...theGoal, id: controls.id } };

    expect(playbookGoalsOf([held, second]).goals.map(({ id }) => id)).toEqual([controls.id, experiments.id]);
  });
});

describe('whether a goal is the one agreed', () => {
  it('compares every field the goal holds, whatever their order, and leaves its id and retired out', () => {
    const { id, ...rest } = theGoal;
    const reordered: Goal = { ...rest, id };

    expect([
      isSameContent({ ...theGoal }, theGoal),
      isSameContent(reordered, theGoal),
      isSameContent({ ...theGoal, retired: true }, theGoal),
      isSameContent({ ...theGoal, id: 'leads-per-week' }, theGoal),
      isSameContent({ ...theGoal, success: { ...theGoal.success, target: { at_least: 2 } } }, theGoal),
    ]).toEqual([true, true, true, true, false]);
  });

  it('counts a field it does not know by name, so a field added to goals later needs a new yes when it changes', () => {
    const named: Goal = { ...theGoal, name: 'Paying customers' };
    const renamed: Goal = { ...theGoal, name: 'Customers from experiments' };
    const nameFirst: Goal = { name: 'Paying customers', ...theGoal };

    expect([
      isSameContent(named, named),
      isSameContent(nameFirst, named),
      isSameContent(renamed, named),
      isSameContent(theGoal, named),
    ]).toEqual([true, true, false, false]);
  });
});
