import { goalsDocumentOf, type Contributes, type Goal } from '@on.auto/definitions/goals';
import { internalTermsIn } from '@on.auto/operations/testing';
import { noGoalGap } from '@on.auto/playbooks';
import { goalsText, leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { Result, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalsAnsweredOf, goalsGapsOf, type GoalsStanding, type StandingWorkflow } from './goal-gaps.ts';

const { goals } = Result.getOrThrow(goalsDocumentOf(goalsText));

function goalAt(index: number): Goal {
  const goal = goals[index];
  if (goal === undefined) {
    throw new Error(`The goals text has no goal ${String(index)}`);
  }
  return goal;
}

const leadGoal = goalAt(0);

const plainGoal = goalAt(1);

const none: ReadonlySet<string> = new Set();

const told: ReadonlySet<string> = new Set(['tell-owner']);

function standingOf(workflows: readonly StandingWorkflow[], notifiers = told, held = goals): GoalsStanding {
  return { version: 1, source: goalsText, goals: held, workflows, notifiers };
}

function workflowNamed(name: string, contributes: Contributes, paused = false): StandingWorkflow {
  return { name, version: 1, paused, contributes };
}

const purpose = 'Does its part.';

const markingAll: Contributes = ['chosen', 'prepared', 'live', 'measured'].map((marks) => ({
  goal: leadGoalId,
  purpose,
  per_id: '/id',
  marks,
}));

const counting = { goal: leadGoalId, purpose, per_id: '/id', measures: '/customers' };

const countingFinal = { ...counting, final: '/closed' };

const ordering = { goal: plainGoalId, purpose, measures: '/orders' };

const kindsOf = (standing: GoalsStanding) =>
  goalsGapsOf(standing).map(({ kind, goal, workflow }) => ({ kind, goal, workflow }));

const detailsOf = (standing: GoalsStanding) => goalsGapsOf(standing).map(({ detail }) => detail);

const withoutPrepared = (leadGoal.milestones ?? []).filter(({ id }) => id !== 'prepared');

const lead = (kind: string) => ({ kind, goal: leadGoalId, workflow: undefined });

describe('the gaps of a playbook with no goals', () => {
  it('are no_goal alone, the person’s', () => {
    const older = { version: 0, goals: [], workflows: [workflowNamed('older', [])], notifiers: none };

    expect(goalsAnsweredOf(older)).toEqual({ gaps: [noGoalGap] });
  });
});

describe('the gaps of goals nothing serves yet', () => {
  it('name every measure, milestone, window and notification function, in the order of the goals', () => {
    const standing = standingOf([], none);

    expect(goalsAnsweredOf(standing)).toMatchObject({ source: goalsText, version: 1 });
    expect(kindsOf(standing)).toEqual([
      lead('measure_unreported'),
      lead('milestone_unmarked'),
      lead('milestone_unmarked'),
      lead('window_never_starts'),
      lead('milestone_unmarked'),
      lead('notice_function_missing'),
      { kind: 'measure_unreported', goal: plainGoalId, workflow: undefined },
    ]);
    expect(goalsGapsOf(standing).every(({ fixed_by: by }) => by === 'agent')).toBe(true);
  });

  it('say what is missing and how the agent puts it right', () => {
    expect(detailsOf(standingOf([], none))).toEqual([
      'No active workflow reports New paying customers for the goal paying-customers: give one a contribution to paying-customers that measures it.',
      'No active workflow marks the milestone chosen (Idea chosen) of the goal paying-customers: give one a contribution to paying-customers that marks it.',
      'No active workflow marks the milestone prepared (Package prepared) of the goal paying-customers: give one a contribution to paying-customers that marks it.',
      'The window of the goal paying-customers starts when live (Taken live) is first marked, and no active workflow marks it: give one a contribution to paying-customers that marks it.',
      'No active workflow marks the milestone measured (Measured) of the goal paying-customers: give one a contribution to paying-customers that marks it.',
      'The goal paying-customers is told through tell-owner, and no notification function of that name is saved: create an interaction function tell-owner that takes no answer, or name one that exists.',
      'No active workflow reports Orders this week for the goal steady-orders: give one a contribution to steady-orders that measures it.',
    ]);
  });
});

describe('the gaps of measures', () => {
  it('say a measure no workflow calls final where the goal has a window, and one only paused workflows report', () => {
    const standing = standingOf([
      workflowNamed('marking', markingAll),
      workflowNamed('counting', [counting]),
      workflowNamed('resting', [ordering], true),
      workflowNamed('also-resting', [ordering], true),
    ]);

    expect(kindsOf(standing)).toEqual([
      lead('measure_never_final'),
      { kind: 'measure_paused', goal: plainGoalId, workflow: undefined },
    ]);
    expect(detailsOf(standing)).toEqual([
      'No workflow that reports New paying customers for the goal paying-customers says when it is final, so no window of it can be judged at its close: give one of them final.',
      'Only paused workflows report Orders this week for the goal steady-orders (resting and also-resting): resume one, or give an active workflow a contribution that measures it.',
    ]);
  });

  it('are none once active workflows report every measure, say when it is final and mark every milestone', () => {
    const served = standingOf([
      workflowNamed('marking', markingAll),
      workflowNamed('counting', [countingFinal, ordering]),
    ]);

    expect(goalsGapsOf(served)).toEqual([]);
    expect(kindsOf(standingOf([workflowNamed('one', [ordering], true)], told, [plainGoal]))).toEqual([
      { kind: 'measure_paused', goal: plainGoalId, workflow: undefined },
    ]);
  });
});

describe('the gaps of milestones', () => {
  it('ask the person for the milestones of a goal judged per thing that names none', () => {
    const unwindowed = { ...Struct.omit(leadGoal, ['window']), milestones: [] };

    expect(goalsGapsOf(standingOf([workflowNamed('counting', [counting])], told, [unwindowed]))).toEqual([
      {
        kind: 'no_milestones',
        goal: leadGoalId,
        detail:
          'Ask the person: What has to happen to one experiment, start to finish, and which of those are yours? The goal paying-customers is judged per experiment and names no milestones; send them in the goals argument of update_playbook.',
        fixed_by: 'person',
        ask: 'What has to happen to one experiment, start to finish, and which of those are yours?',
      },
    ]);
  });
});

const gone = { goal: 'left-out', purpose, measures: '/n' };

const orphaning = standingOf(
  [
    workflowNamed('older', []),
    workflowNamed('idle', [], true),
    workflowNamed('marking', [...markingAll, countingFinal]),
    workflowNamed('ordering', [ordering, ordering, gone, gone]),
    workflowNamed('resting', [gone], true),
  ],
  told,
  [
    { ...leadGoal, milestones: withoutPrepared },
    { ...plainGoal, retired: true },
  ],
);

describe('the gaps of workflows and their contributions', () => {
  it('name an active workflow with no contribution, and contributions to a retired goal, a goal left out or a milestone gone', () => {
    expect(kindsOf(orphaning)).toEqual([
      { kind: 'workflow_without_contribution', goal: undefined, workflow: 'older' },
      { kind: 'contribution_orphaned', goal: leadGoalId, workflow: 'marking' },
      { kind: 'contribution_orphaned', goal: plainGoalId, workflow: 'ordering' },
      { kind: 'contribution_orphaned', goal: 'left-out', workflow: 'ordering' },
    ]);
  });

  it('say which workflow to save again, and why', () => {
    expect(detailsOf(orphaning)).toEqual([
      'The workflow older contributes to no goal: save it again with a contribution to the goal it serves.',
      'The workflow marking marks prepared, a milestone the goal paying-customers no longer has: save it again marking one it has.',
      'The workflow ordering contributes to the goal steady-orders, which is retired: save it again with a contribution to a goal that is kept.',
      'The workflow ordering contributes to the goal left-out, which the playbook no longer has: save it again with a contribution to a goal that is kept.',
    ]);
  });
});

const summing: Goal = {
  ...leadGoal,
  notify: { passed: 'now', failed: 'now', ...leadGoal.notify, summary: { cron: '0 9 * * 5', through: 'weekly-note' } },
};

const marked = [workflowNamed('marking', [...markingAll, countingFinal])];

describe('the gaps of notification functions', () => {
  it('name each function a goal is told through once, its summary’s too', () => {
    expect(kindsOf(standingOf(marked, none, [summing]))).toEqual([
      lead('notice_function_missing'),
      lead('notice_function_missing'),
    ]);
    expect(detailsOf(standingOf(marked, told, [summing]))).toEqual([
      'The goal paying-customers is told through weekly-note, and no notification function of that name is saved: create an interaction function weekly-note that takes no answer, or name one that exists.',
    ]);
  });

  it('name none for a goal that leaves notify out, which owes the person nothing', () => {
    const { notify: _told, ...untold } = leadGoal;

    expect(kindsOf(standingOf(marked, none, [untold]))).toEqual([]);
  });
});

const everyDetail = [
  ...detailsOf(standingOf([], none)),
  ...detailsOf(orphaning),
  ...detailsOf(standingOf([workflowNamed('counting', [counting]), workflowNamed('resting', [ordering], true)])),
];

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

describe('the words of the gaps', () => {
  it('carry no internal terms, and each fits in 256 bytes', () => {
    expect(everyDetail.flatMap((detail) => internalTermsIn(detail))).toEqual([]);
    expect(everyDetail.filter((detail) => bytesOf(detail) > 256)).toEqual([]);
  });
});
