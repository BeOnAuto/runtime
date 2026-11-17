import { WeekdaySchema } from '@on.auto/definitions/goals';
import { Schema } from 'effect';

const InstantText = Schema.String;

const ToldSchema = Schema.Literals(['now', 'summary', 'quiet']);

const VerdictSchema = Schema.Literals(['passed', 'failed']);

const ChangeSchema = Schema.Literals(['passed', 'failed', 'overdue']);

const WindowSpanSchema = Schema.Struct({ opens: InstantText, closes: InstantText, due: InstantText });

const TargetSchema = Schema.Union([
  Schema.Struct({ at_least: Schema.Finite }),
  Schema.Struct({ at_most: Schema.Finite }),
]);

const WindowRuleSchema = Schema.Union([
  Schema.Struct({ after: Schema.String, for: Schema.String, grace: Schema.optionalKey(Schema.String) }),
  Schema.Struct({
    calendar: Schema.Literals(['day', 'week', 'month']),
    time_zone: Schema.optionalKey(Schema.String),
    grace: Schema.optionalKey(Schema.String),
    days: Schema.optionalKey(Schema.Array(WeekdaySchema)),
  }),
]);

const MilestoneSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  by: Schema.Literals(['person', 'auto']),
});

const SourceSchema = Schema.Struct({
  record: Schema.String,
  run: Schema.String,
  workflow: Schema.String,
  version: Schema.Int,
  entry: Schema.Int,
  item: Schema.optionalKey(Schema.Int),
});

const GoalAssessmentOpenedSchema = Schema.Struct({
  goal: Schema.String,
  goals_version: Schema.Int,
  per: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
  window: Schema.optionalKey(WindowSpanSchema),
  rule: Schema.Struct({
    settles: Schema.Literals(['on_crossing', 'at_close']),
    target: TargetSchema,
    window: Schema.optionalKey(WindowRuleSchema),
  }),
  milestones: Schema.Array(MilestoneSchema),
});

const GoalObservedSchema = Schema.Struct({
  source: SourceSchema,
  at: InstantText,
  marks: Schema.optionalKey(Schema.String),
  measurement: Schema.optionalKey(Schema.Struct({ value: Schema.Finite, final: Schema.Boolean, as_of: InstantText })),
  title: Schema.optionalKey(Schema.String),
  link: Schema.optionalKey(Schema.String),
  says: Schema.optionalKey(Schema.String),
  window: Schema.optionalKey(WindowSpanSchema),
});

const GoalAssessedSchema = Schema.Struct({
  verdict: VerdictSchema,
  at: InstantText,
  by: Schema.Literals(['crossing', 'final', 'deadline']),
  told: ToldSchema,
  source: Schema.optionalKey(SourceSchema),
});

const GoalOverdueSchema = Schema.Struct({ since: InstantText, told: ToldSchema });

const GoalNoticeStartedSchema = Schema.Struct({ change: ChangeSchema, run: Schema.String });

const GoalNoticeRefusedSchema = Schema.Struct({
  change: Schema.Literals(['passed', 'failed', 'overdue', 'summary']),
  attempt: Schema.Int,
  detail: Schema.String,
  retry_at: Schema.optionalKey(InstantText),
});

const GoalSummaryStartedSchema = Schema.Struct({
  due: InstantText,
  window: Schema.Struct({ from: InstantText, to: InstantText }),
  run: Schema.String,
});

const GoalAssessmentEndedSchema = Schema.Struct({
  reason: Schema.Literals(['no_result', 'goal_retired', 'playbook_retired']),
});

const GoalStoppedSchema = Schema.Struct({ run: Schema.String, at: InstantText, reason: Schema.String });

const GoalObservationRefusedSchema = Schema.Struct({ run: Schema.String, detail: Schema.String });

export const goalFactData = {
  goal_assessment_opened: GoalAssessmentOpenedSchema,
  goal_observed: GoalObservedSchema,
  goal_assessed: GoalAssessedSchema,
  goal_overdue: GoalOverdueSchema,
  goal_notice_started: GoalNoticeStartedSchema,
  goal_notice_refused: GoalNoticeRefusedSchema,
  goal_summary_started: GoalSummaryStartedSchema,
  goal_assessment_ended: GoalAssessmentEndedSchema,
  goal_stopped: GoalStoppedSchema,
  goal_observation_refused: GoalObservationRefusedSchema,
} as const;

function decidedOf<const Type extends string, Data extends Schema.Top>(type: Type, data: Data) {
  return Schema.Struct({ type: Schema.Literal(type), data });
}

export const AssessmentFactSchema = Schema.Union([
  decidedOf('goal_assessment_opened', GoalAssessmentOpenedSchema),
  decidedOf('goal_observed', GoalObservedSchema),
  decidedOf('goal_assessed', GoalAssessedSchema),
  decidedOf('goal_overdue', GoalOverdueSchema),
  decidedOf('goal_notice_started', GoalNoticeStartedSchema),
  decidedOf('goal_notice_refused', GoalNoticeRefusedSchema),
  decidedOf('goal_assessment_ended', GoalAssessmentEndedSchema),
  decidedOf('goal_stopped', GoalStoppedSchema),
]);

export type AssessmentFact = typeof AssessmentFactSchema.Type;

export type AssessmentOpened = typeof GoalAssessmentOpenedSchema.Type;

export type GoalObserved = typeof GoalObservedSchema.Type;

export type JudgedBy = (typeof GoalAssessedSchema.Type)['by'];

export type EndReason = (typeof GoalAssessmentEndedSchema.Type)['reason'];

export type GoalStopped = typeof GoalStoppedSchema.Type;
