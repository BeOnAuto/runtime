import { ActedContextSchema, factOf, streamPrefixOfDefinition } from '@on.auto/operations';
import { Schema } from 'effect';

import { goalFactData } from '../assessments/assessment-facts.ts';

export const assessmentsKind = 'assessments';

export const goalRefusalsKind = 'goal-refusals';

export const goalSummariesKind = 'goal-summaries';

export interface GoalAddress {
  readonly org: string;
  readonly definition: string;
}

export const summariesStreamId = 'summary';

export function assessmentStreamOf(goal: GoalAddress, assessment: string): string {
  return `${streamPrefixOfDefinition(goal)}${assessmentsKind}/${assessment}`;
}

export function refusalsStreamOf(goal: GoalAddress, workflow: string): string {
  return `${streamPrefixOfDefinition(goal)}${goalRefusalsKind}/${workflow}`;
}

export function summariesStreamOf(goal: GoalAddress): string {
  return `${streamPrefixOfDefinition(goal)}${goalSummariesKind}/${summariesStreamId}`;
}

const GoalResultContextSchema = Schema.Struct({
  ...ActedContextSchema.fields,
  definitionId: Schema.optionalKey(Schema.String),
  definitionName: Schema.optionalKey(Schema.String),
});

const noticeRefused = factOf('goal_notice_refused', goalFactData.goal_notice_refused, GoalResultContextSchema);

const dismissed = factOf('goal_dismissed', goalFactData.goal_dismissed, GoalResultContextSchema);

const restored = factOf('goal_restored', goalFactData.goal_restored, GoalResultContextSchema);

export const DismissalEventSchema = Schema.Union([dismissed, restored]);

export const AssessmentEventSchema = Schema.Union([
  factOf('goal_assessment_opened', goalFactData.goal_assessment_opened, GoalResultContextSchema),
  factOf('goal_observed', goalFactData.goal_observed, GoalResultContextSchema),
  factOf('goal_assessed', goalFactData.goal_assessed, GoalResultContextSchema),
  factOf('goal_overdue', goalFactData.goal_overdue, GoalResultContextSchema),
  factOf('goal_notice_started', goalFactData.goal_notice_started, GoalResultContextSchema),
  noticeRefused,
  factOf('goal_assessment_ended', goalFactData.goal_assessment_ended, GoalResultContextSchema),
  factOf('goal_stopped', goalFactData.goal_stopped, GoalResultContextSchema),
  dismissed,
  restored,
]);

export type RecordedAssessmentEvent = typeof AssessmentEventSchema.Type;

export const GoalSummaryEventSchema = Schema.Union([
  factOf('goal_summary_started', goalFactData.goal_summary_started, GoalResultContextSchema),
  noticeRefused,
]);

export type RecordedGoalSummaryEvent = typeof GoalSummaryEventSchema.Type;

export const GoalRefusalEventSchema = Schema.Union([
  factOf('goal_observation_refused', goalFactData.goal_observation_refused, GoalResultContextSchema),
]);

export type RecordedGoalRefusalEvent = typeof GoalRefusalEventSchema.Type;

export const goalFactSchemas = [AssessmentEventSchema, GoalSummaryEventSchema, GoalRefusalEventSchema];
