import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

import { GoalsSchema } from './goals-document.ts';

export const GoalsEventSchema = Schema.Union([
  factOf(
    'playbook_goals_saved',
    Schema.Struct({ source: Schema.String, goals: GoalsSchema, version: Schema.Int }),
    ActedContextSchema,
  ),
]);

export type RecordedGoalsEvent = typeof GoalsEventSchema.Type;

const GoalAgreementSchema = Schema.Struct({
  goal: Schema.String,
  version: Schema.Int,
  at: Schema.String,
  by: Schema.String,
  content: GoalsSchema.value,
});

export type GoalAgreement = typeof GoalAgreementSchema.Type;

export const GoalAgreementsEventSchema = Schema.Union([
  factOf('playbook_goals_agreed', Schema.Struct({ agreements: Schema.Array(GoalAgreementSchema) }), ActedContextSchema),
]);

export type RecordedGoalAgreementsEvent = typeof GoalAgreementsEventSchema.Type;
