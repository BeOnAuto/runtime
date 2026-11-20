import { heldGoalNamed, type Contributes, type Goal } from '@on.auto/definitions/goals';
import type { GoalGap } from '@on.auto/playbooks';

import { goalsAnsweredOf, type GoalsStanding, type StandingWorkflow } from '../gaps/goal-gaps.ts';
import { noAssessments, type Assessments } from './assessments-schema.ts';
import type { GoalRead, GoalsRead } from './goals-read-schema.ts';

export type AssessmentsOfGoal = (goal: Goal) => Assessments | undefined;

type ContributionRead = GoalRead['contributions'][number];

function contributionOf(workflow: string, { purpose, marks, measures }: Contributes[number]): ContributionRead {
  const marked = marks === undefined ? {} : { marks };
  return { workflow, purpose, ...marked, measures: measures !== undefined };
}

function contributionsTo({ id }: Goal, workflows: readonly StandingWorkflow[]): readonly ContributionRead[] {
  return workflows.flatMap(({ name, contributes }) =>
    contributes.filter(({ goal }) => goal === id).map((entry) => contributionOf(name, entry)),
  );
}

interface GoalParts {
  readonly gaps: readonly GoalGap[];
  readonly workflows: readonly StandingWorkflow[];
  readonly assessmentsOf: AssessmentsOfGoal;
  readonly standing: GoalsStanding;
}

function agreedOf(goal: Goal, standing: GoalsStanding): Pick<GoalRead, 'agreed'> {
  const agreed = heldGoalNamed(standing, goal.id)?.agreed;
  return agreed === undefined ? {} : { agreed };
}

function goalReadOf(goal: Goal, { gaps, workflows, assessmentsOf, standing }: GoalParts): GoalRead {
  const { milestones = [], ...written } = goal;
  return {
    ...written,
    ...agreedOf(goal, standing),
    milestones,
    gaps: gaps.filter(({ goal: about }) => about === goal.id),
    contributions: contributionsTo(goal, workflows),
    assessments: assessmentsOf(goal) ?? noAssessments,
  };
}

export function goalsReadOf(
  standing: GoalsStanding,
  assessmentsOf: AssessmentsOfGoal = () => noAssessments,
  noticeGaps: readonly GoalGap[] = [],
): GoalsRead {
  const { goals, workflows } = standing;
  const gaps = [...goalsAnsweredOf(standing).gaps, ...noticeGaps];
  const listed = new Set(goals.map(({ id }) => id));
  return {
    gaps: gaps.filter(({ goal }) => goal === undefined || !listed.has(goal)),
    goals: goals.map((goal) => goalReadOf(goal, { gaps, workflows, assessmentsOf, standing })),
  };
}
