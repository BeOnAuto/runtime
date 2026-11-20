import { Schema } from 'effect';
import { stringify } from 'yaml';

export const goalIdPattern = /^[a-z][a-z0-9-]{2,47}$/u;

export const mostGoalsBytes = 16_384;

export const mostGoals = 8;

export const ToldSchema = Schema.Literals(['now', 'summary', 'quiet']);

export type Told = typeof ToldSchema.Type;

export const SettlesSchema = Schema.Literals(['on_crossing', 'at_close']);

export const CalendarUnitSchema = Schema.Literals(['day', 'week', 'month']);

export const WeekdaySchema = Schema.Literals([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

export type Weekday = typeof WeekdaySchema.Type;

export const MarkedBySchema = Schema.Literals(['person', 'auto']);

const MilestoneSchema = Schema.Struct({ id: Schema.String, label: Schema.String, by: MarkedBySchema });

const AfterWindowSchema = Schema.Struct({
  after: Schema.String,
  for: Schema.String,
  grace: Schema.optionalKey(Schema.String),
});

const CalendarWindowSchema = Schema.Struct({
  calendar: CalendarUnitSchema,
  time_zone: Schema.optionalKey(Schema.String),
  grace: Schema.optionalKey(Schema.String),
  days: Schema.optionalKey(Schema.Array(WeekdaySchema)),
});

const GoalWindowSchema = Schema.Union([AfterWindowSchema, CalendarWindowSchema]);

type CalendarWindow = typeof CalendarWindowSchema.Type;

type GoalWindow = typeof GoalWindowSchema.Type;

const TargetSchema = Schema.Union([
  Schema.Struct({ at_least: Schema.Finite }),
  Schema.Struct({ at_most: Schema.Finite }),
]);

const SuccessSchema = Schema.Struct({
  label: Schema.String,
  settles: SettlesSchema,
  target: TargetSchema,
  passed: Schema.String,
  failed: Schema.String,
});

const SummarySchema = Schema.Struct({
  cron: Schema.String,
  time_zone: Schema.optionalKey(Schema.String),
  through: Schema.optionalKey(Schema.String),
});

const NotifySchema = Schema.Struct({
  passed: ToldSchema,
  failed: ToldSchema,
  overdue: Schema.optionalKey(ToldSchema),
  through: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(SummarySchema),
});

const GoalSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  statement: Schema.String,
  per: Schema.optionalKey(Schema.String),
  window: Schema.optionalKey(GoalWindowSchema),
  success: SuccessSchema,
  milestones: Schema.optionalKey(Schema.Array(MilestoneSchema)),
  notify: Schema.optionalKey(NotifySchema),
  retired: Schema.optionalKey(Schema.Boolean),
});

export type Goal = typeof GoalSchema.Type;

export const GoalsSchema = Schema.Array(GoalSchema);

export type Goals = typeof GoalsSchema.Type;

export interface GoalsDocument {
  readonly source: string;
  readonly goals: Goals;
}

export function goalsSourceOf(goals: Goals): string {
  return stringify(goals, { aliasDuplicateObjects: false });
}

export function isCalendarWindow(window: GoalWindow): window is CalendarWindow {
  return 'calendar' in window;
}

const mostContributions = 8;

export const ContributionEntrySchema = Schema.Struct({
  goal: Schema.String,
  purpose: Schema.String,
  each: Schema.optionalKey(Schema.String),
  per_id: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  link: Schema.optionalKey(Schema.String),
  when: Schema.optionalKey(Schema.String),
  marks: Schema.optionalKey(Schema.String),
  measures: Schema.optionalKey(Schema.String),
  final: Schema.optionalKey(Schema.Union([Schema.String, Schema.Literal(true)])),
  as_of: Schema.optionalKey(Schema.String),
  says: Schema.optionalKey(Schema.String),
});

export type ContributionEntry = typeof ContributionEntrySchema.Type;

export const ContributesSchema = Schema.Array(ContributionEntrySchema).check(Schema.isMaxLength(mostContributions));
