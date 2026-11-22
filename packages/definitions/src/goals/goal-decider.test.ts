import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { goalsDocumentOfTheExamples } from '../testing/goals-book.ts';
import {
  decidedOnAGoal,
  goalFoldOf,
  isSameContent,
  standingYesOf,
  type GoalCommand,
  type GoalState,
} from './goal-decider.ts';
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

describe("a goal's move", () => {
  it('moves a goal held at the version it was read at, retired or not, and refuses one gone, moved away or changed since, as changed meanwhile', () => {
    const movedBy = { id: acting.by, name: 'Ada Lovelace' };
    const move: GoalCommand = {
      type: 'move',
      to: 'beta',
      moved_by: movedBy,
      position: 4,
      expectedVersion: 3,
      ...acting,
    };
    const moved = { type: 'goal_moved', data: { from: 'alpha', to: 'beta', moved_by: movedBy, position: 4 } };

    expect([
      decidedOnAGoal(move, held),
      decidedOnAGoal(move, { ...held, goal: { ...theGoal, retired: true } }),
      decidedOnAGoal(move, goalFoldOf('goal-1').initialState),
      decidedOnAGoal(move, { ...held, removed: true }),
      decidedOnAGoal(move, { ...held, playbook: 'beta' }),
      decidedOnAGoal(move, { ...held, version: 4 }),
    ]).toEqual([
      Result.succeed([moved]),
      Result.succeed([moved]),
      Result.fail(changedMeanwhile),
      Result.fail(changedMeanwhile),
      Result.fail(changedMeanwhile),
      Result.fail(changedMeanwhile),
    ]);
  });
});

const leadsPerWeek = 'leads-per-week';

const rename: GoalCommand = {
  type: 'rename',
  from: experiments.id,
  to: leadsPerWeek,
  renamed_by: { id: acting.by, name: 'Ada' },
  ...acting,
};

function refusedAt(pointer: string): unknown {
  return Result.fail(expect.objectContaining({ _tag: 'invalid_input', issues: [{ pointer, detail: someWords }] }));
}

describe("a goal's rename, decided", () => {
  it('records the new id of a goal held in the playbook by the id it has, and refuses one gone, elsewhere, of another id, or to the id it has', () => {
    const noGoal = refusedAt('/rename_goal/id');

    expect([
      decidedOnAGoal(rename, held),
      decidedOnAGoal(rename, goalFoldOf('goal-1').initialState),
      decidedOnAGoal(rename, { ...held, removed: true }),
      decidedOnAGoal(rename, { ...held, playbook: 'beta' }),
      decidedOnAGoal(rename, { ...held, name: controls.id }),
      decidedOnAGoal({ ...rename, to: experiments.id }, held),
    ]).toEqual([
      Result.succeed([
        {
          type: 'goal_renamed',
          data: { from: experiments.id, to: leadsPerWeek, renamed_by: { id: acting.by, name: 'Ada' } },
        },
      ]),
      noGoal,
      noGoal,
      noGoal,
      noGoal,
      refusedAt('/rename_goal/new_id'),
    ]);
  });

  it("folds into the goal's name and id at the version it had, with the person's yes standing, and a save of the old id refused", () => {
    const fold = goalFoldOf('goal-1');
    const agreed = { version: 3, at: acting.at, by: acting.by, content: theGoal };
    const renamed: RecordedGoalEvent = {
      type: 'goal_renamed',
      data: { from: experiments.id, to: leadsPerWeek, renamed_by: { id: acting.by, name: 'Ada' } },
      context: { at: acting.at, by: acting.by, definitionId: 'goal-1' },
    };

    const after = Option.getOrThrow(Option.fromNullishOr(fold.evolve({ ...held, agreed }, renamed)));
    const saving = (id: string): GoalCommand => ({ type: 'save', goal: { ...theGoal, id }, position: 0, ...acting });

    expect([after.name, after.goal.id, after.version]).toEqual([leadsPerWeek, leadsPerWeek, 3]);
    expect(standingYesOf(after)).toEqual(agreed);
    expect([decidedOnAGoal(saving(experiments.id), after), decidedOnAGoal(saving(leadsPerWeek), after)]).toEqual([
      Result.fail(changedMeanwhile),
      Result.succeed([]),
    ]);
  });
});

describe("a goal's record, read after a move", () => {
  it('holds a goal that moved in the playbook it moved to, at its new place, with its version and the yes it had, so a save or a yes is taken there and refused where it was', () => {
    const fold = goalFoldOf('goal-1');
    const context = { at: acting.at, by: acting.by, definitionId: 'goal-1' };
    const facts: readonly RecordedGoalEvent[] = [
      { type: 'goal_created', data: { playbook: 'alpha', position: 0, goal: theGoal }, context },
      { type: 'goal_agreed', data: { version: 1 }, context },
      {
        type: 'goal_moved',
        data: { from: 'alpha', to: 'beta', moved_by: { id: acting.by, name: 'Ada Lovelace' }, position: 2 },
        context,
      },
    ];
    const state = facts.reduce((before, fact) => fold.evolve(before, fact), fold.initialState);
    const agree = (playbook: string): GoalCommand => ({ type: 'agree', seen: [1], ...acting, playbook });
    const save = (playbook: string): GoalCommand => ({ type: 'save', goal: theGoal, position: 2, ...acting, playbook });

    expect(state).toMatchObject({ playbook: 'beta', position: 2, version: 1, agreed: { version: 1 } });
    expect([
      decidedOnAGoal(save('beta'), state),
      decidedOnAGoal(agree('beta'), state),
      decidedOnAGoal(save('alpha'), state),
      decidedOnAGoal(agree('alpha'), state),
    ]).toEqual([Result.succeed([]), Result.succeed([]), Result.fail(changedMeanwhile), Result.fail(changedMeanwhile)]);
  });
});

describe("a goal's rename and move, one after the other", () => {
  it('moves a goal renamed, at the version it kept, and renames a goal moved where it moved, not where it was', () => {
    const fold = goalFoldOf('goal-1');
    const context = { at: acting.at, by: acting.by, definitionId: 'goal-1' };
    const movedBy = { id: acting.by, name: 'Ada' };
    const facts = (...later: readonly RecordedGoalEvent[]): readonly RecordedGoalEvent[] => [
      { type: 'goal_created', data: { playbook: 'alpha', position: 0, goal: theGoal }, context },
      ...later,
    ];
    const foldedOver = (recorded: readonly RecordedGoalEvent[]) =>
      recorded.reduce((before, fact) => fold.evolve(before, fact), fold.initialState);
    const renamedFirst = foldedOver(
      facts({ type: 'goal_renamed', data: { from: experiments.id, to: leadsPerWeek, renamed_by: movedBy }, context }),
    );
    const movedFirst = foldedOver(
      facts({ type: 'goal_moved', data: { from: 'alpha', to: 'beta', moved_by: movedBy, position: 1 }, context }),
    );
    const move: GoalCommand = {
      type: 'move',
      to: 'beta',
      moved_by: movedBy,
      position: 1,
      expectedVersion: 1,
      ...acting,
    };

    expect([
      decidedOnAGoal(move, renamedFirst),
      decidedOnAGoal({ ...rename, playbook: 'beta' }, movedFirst),
      decidedOnAGoal(rename, movedFirst),
    ]).toMatchObject([
      { _tag: 'Success', success: [{ type: 'goal_moved' }] },
      { _tag: 'Success', success: [{ type: 'goal_renamed' }] },
      { _tag: 'Failure', failure: { _tag: 'invalid_input' } },
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
