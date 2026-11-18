import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

import { goalFactData } from '../assessments/assessment-facts.ts';

export const assessmentsKind = 'assessments';

export const goalRefusalsKind = 'goal-refusals';

export const goalSummariesKind = 'goal-summaries';

const noticeRefused = factOf('goal_notice_refused', goalFactData.goal_notice_refused, ActedContextSchema);

const dismissed = factOf('goal_dismissed', goalFactData.goal_dismissed, ActedContextSchema);

const restored = factOf('goal_restored', goalFactData.goal_restored, ActedContextSchema);

export const DismissalEventSchema = Schema.Union([dismissed, restored]);

export const AssessmentEventSchema = Schema.Union([
  factOf('goal_assessment_opened', goalFactData.goal_assessment_opened, ActedContextSchema),
  factOf('goal_observed', goalFactData.goal_observed, ActedContextSchema),
  factOf('goal_assessed', goalFactData.goal_assessed, ActedContextSchema),
  factOf('goal_overdue', goalFactData.goal_overdue, ActedContextSchema),
  factOf('goal_notice_started', goalFactData.goal_notice_started, ActedContextSchema),
  noticeRefused,
  factOf('goal_assessment_ended', goalFactData.goal_assessment_ended, ActedContextSchema),
  factOf('goal_stopped', goalFactData.goal_stopped, ActedContextSchema),
  dismissed,
  restored,
]);

export type RecordedAssessmentEvent = typeof AssessmentEventSchema.Type;

export const GoalSummaryEventSchema = Schema.Union([
  factOf('goal_summary_started', goalFactData.goal_summary_started, ActedContextSchema),
  noticeRefused,
]);

export type RecordedGoalSummaryEvent = typeof GoalSummaryEventSchema.Type;

export const GoalRefusalEventSchema = Schema.Union([
  factOf('goal_observation_refused', goalFactData.goal_observation_refused, ActedContextSchema),
]);

export type RecordedGoalRefusalEvent = typeof GoalRefusalEventSchema.Type;

export const goalFactSchemas = [AssessmentEventSchema, GoalSummaryEventSchema, GoalRefusalEventSchema];
