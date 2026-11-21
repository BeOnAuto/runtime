import { ActedContextSchema, factOf, RecordedCallerSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { GoalsSchema } from './goals-document.ts';

export const PlaybookGoalsEventSchema = Schema.Union([
  factOf(
    'playbook_goals_saved',
    Schema.Struct({ source: Schema.String, goals: GoalsSchema, version: Schema.Int }),
    ActedContextSchema,
  ),
]);

export type RecordedPlaybookGoalsEvent = typeof PlaybookGoalsEventSchema.Type;

const PlaybookGoalAgreementSchema = Schema.Struct({
  goal: Schema.String,
  version: Schema.Int,
  at: Schema.String,
  by: Schema.String,
  content: GoalsSchema.value,
});

export const PlaybookGoalAgreementsEventSchema = Schema.Union([
  factOf(
    'playbook_goals_agreed',
    Schema.Struct({ agreements: Schema.Array(PlaybookGoalAgreementSchema) }),
    ActedContextSchema,
  ),
]);

export type RecordedPlaybookGoalAgreementsEvent = typeof PlaybookGoalAgreementsEventSchema.Type;

const GoalContextSchema = Schema.Struct({ ...ActedContextSchema.fields, definitionId: Schema.String });

const Position = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const GoalEventSchema = Schema.Union([
  factOf(
    'goal_created',
    Schema.Struct({ playbook: Schema.String, position: Position, goal: GoalsSchema.value }),
    GoalContextSchema,
  ),
  factOf('goal_updated', Schema.Struct({ goal: GoalsSchema.value }), GoalContextSchema),
  factOf('goal_reordered', Schema.Struct({ position: Position }), GoalContextSchema),
  factOf('goal_agreed', Schema.Struct({ version: Schema.Int }), GoalContextSchema),
  factOf('goal_removed', Schema.Struct({}), GoalContextSchema),
  factOf(
    'goal_renamed',
    Schema.Struct({ from: Schema.String, to: Schema.String, renamed_by: RecordedCallerSchema }),
    GoalContextSchema,
  ),
]);

export type RecordedGoalEvent = typeof GoalEventSchema.Type;

export const goalFactTypes: readonly RecordedGoalEvent['type'][] = [
  'goal_created',
  'goal_updated',
  'goal_reordered',
  'goal_agreed',
  'goal_removed',
  'goal_renamed',
];
