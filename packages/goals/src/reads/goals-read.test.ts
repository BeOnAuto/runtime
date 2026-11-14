import { goalsDocumentOf, type Contributes, type Goal } from '@on.auto/definitions/goals';
import { goalsText, leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { GoalsStanding, StandingWorkflow } from '../gaps/goal-gaps.ts';
import { noAssessments } from './assessments-schema.ts';
import { GoalsReadSchema } from './goals-read-schema.ts';
import { goalsReadOf } from './goals-read.ts';

const { goals } = Result.getOrThrow(goalsDocumentOf(goalsText));

const purpose = 'Does its part.';

const marking: Contributes = [{ goal: leadGoalId, purpose, per_id: '/id', marks: 'chosen' }];

const counting: Contributes = [
  { goal: leadGoalId, purpose: 'Counts the customers.', per_id: '/id', measures: '/customers' },
  { goal: plainGoalId, purpose: 'Counts the orders.', measures: '/orders' },
];

function workflowNamed(name: string, contributes: Contributes, paused = false): StandingWorkflow {
  return { name, version: 1, paused, contributes };
}

function standingOf(workflows: readonly StandingWorkflow[]): GoalsStanding {
  return { version: 2, source: goalsText, goals, workflows, notifiers: new Set(['tell-owner']) };
}

const encoded = Schema.encodeUnknownSync(GoalsReadSchema);

describe('the goals read of a playbook with no goals', () => {
  it('answers version 0, no goals and the gap no_goal among the playbook’s own', () => {
    const read = goalsReadOf({ version: 0, goals: [], workflows: [], notifiers: new Set() });

    expect(read).toEqual({ version: 0, gaps: [expect.objectContaining({ kind: 'no_goal' })], goals: [] });
    expect(encoded(read)).toEqual(read);
  });
});

describe('the goals read of a playbook with goals', () => {
  const read = goalsReadOf(
    standingOf([
      workflowNamed('marking', marking),
      workflowNamed('counting', counting, true),
      workflowNamed('tidy', []),
      workflowNamed('stray', [{ goal: 'gone-goal', purpose }]),
    ]),
  );
  const [lead, plain] = read.goals;

  it('answers each goal as written, in order, with the milestones it has or none', () => {
    expect(read.version).toBe(2);
    expect(lead).toMatchObject({
      id: leadGoalId,
      per: 'experiment',
      window: { after: 'live', for: 'P7D', grace: 'P1D' },
      success: { settles: 'on_crossing', target: { at_least: 1 } },
      notify: { passed: 'now', through: 'tell-owner' },
    });
    expect(lead?.milestones.map(({ id }) => id)).toEqual(['chosen', 'prepared', 'live', 'measured']);
    expect(plain).toMatchObject({ id: plainGoalId, milestones: [] });
    expect(plain).not.toHaveProperty('window');
  });

  it('answers what each workflow that is not retired does for each goal, paused ones too', () => {
    expect(lead?.contributions).toEqual([
      { workflow: 'marking', purpose, marks: 'chosen', measures: false },
      { workflow: 'counting', purpose: 'Counts the customers.', measures: true },
    ]);
    expect(plain?.contributions).toEqual([{ workflow: 'counting', purpose: 'Counts the orders.', measures: true }]);
  });

  it('puts each gap of a goal under it, and the gaps no listed goal owns under the playbook', () => {
    expect(read.gaps.map(({ kind, goal, workflow }) => ({ kind, goal, workflow }))).toEqual([
      { kind: 'workflow_without_contribution', goal: undefined, workflow: 'tidy' },
      { kind: 'contribution_orphaned', goal: 'gone-goal', workflow: 'stray' },
    ]);
    expect(lead?.gaps.every(({ goal }) => goal === leadGoalId)).toBe(true);
    expect(plain?.gaps.map(({ kind }) => kind)).toEqual(['measure_paused']);
  });

  it('answers the assessments as none yet, in their full shape, and fits the read’s schema', () => {
    expect(read.goals.map(({ assessments }) => assessments)).toEqual([noAssessments, noAssessments]);
    expect(encoded(read)).toEqual(read);
  });
});

describe('the assessments of a goals read', () => {
  it('are asked of each goal by the part that knows them', () => {
    const asked: string[] = [];
    const counted = { ...noAssessments, open_count: 3 };
    const read = goalsReadOf(standingOf([]), ({ id }) => {
      asked.push(id);
      return counted;
    });

    expect(asked).toEqual([leadGoalId, plainGoalId]);
    expect(
      goalsReadOf(standingOf([]), ({ id }) => new Map([[id, counted]]).get('elsewhere')).goals[0]?.assessments,
    ).toEqual(noAssessments);
    expect(read.goals.map(({ assessments }) => assessments.open_count)).toEqual([3, 3]);
  });
});

describe('the goals read of a daily goal judged on weekdays', () => {
  it('answers the days its window is judged on, as written, and fits the read’s schema', () => {
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
    const daily = {
      id: 'stock-holds',
      statement: 'Keep two weeks of stock at every weekday check.',
      window: { calendar: 'day', time_zone: 'America/Los_Angeles', grace: 'PT1H', days: weekdays },
      success: {
        label: 'Days of cover',
        settles: 'at_close',
        target: { at_least: 14 },
        passed: 'Met',
        failed: 'Under',
      },
    } as const;
    const read = goalsReadOf({ version: 1, goals: [daily], workflows: [], notifiers: new Set() });

    expect(read.goals[0]?.window).toEqual(daily.window);
    expect(encoded(read)).toEqual(read);
  });
});

function goalAt(index: number): Goal {
  const goal = goals[index];
  if (goal === undefined) {
    throw new Error(`The goals text holds no goal at ${String(index)}`);
  }
  return goal;
}

describe('the yes to each goal on the goals read', () => {
  const lead = goalAt(0);
  const agreement = { goal: leadGoalId, version: 2, at: '2026-11-13T10:00:00.000Z', by: 'person:user_2ada' };

  it('is the yes recorded to a goal as it is saved now, and none for a goal with no yes', () => {
    const read = goalsReadOf(standingOf([]), undefined, [], {
      agreements: [{ ...agreement, content: { ...lead, retired: false } }],
    });

    expect(read.goals.map(({ agreed }) => agreed)).toEqual([
      { at: '2026-11-13T10:00:00.000Z', by: 'person:user_2ada', version: 2 },
      undefined,
    ]);
    expect(read.goals[1]).not.toHaveProperty('agreed');
    expect(encoded(read)).toEqual(read);
  });

  it('is gone once the goal was saved with a change after the yes', () => {
    const before = { ...lead, statement: 'An earlier statement.' };
    const read = goalsReadOf(standingOf([]), undefined, [], {
      agreements: [
        { ...agreement, content: before },
        { ...agreement, goal: plainGoalId, content: lead },
      ],
    });

    expect(read.goals.map(({ agreed }) => agreed)).toEqual([undefined, undefined]);
  });
});
