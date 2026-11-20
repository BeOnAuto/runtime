import { WeekdaySchema } from '@on.auto/definitions/goals';
import { Option, Schema } from 'effect';

import type { AssessmentState } from '../assessments/assessment-state.ts';

const Instant = Schema.Finite;

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

const PinnedRuleSchema = Schema.Struct({
  goal: Schema.String,
  goalsVersion: Schema.Int,
  per: Schema.optionalKey(Schema.String),
  settles: Schema.Literals(['on_crossing', 'at_close']),
  target: TargetSchema,
  window: Schema.optionalKey(WindowRuleSchema),
  milestones: Schema.Array(
    Schema.Struct({ id: Schema.String, label: Schema.String, by: Schema.Literals(['person', 'auto']) }),
  ),
});

const MarkSchema = Schema.Struct({
  milestone: Schema.String,
  at: Instant,
  run: Schema.String,
  says: Schema.optionalKey(Schema.String),
});

const StandingSchema = Schema.Struct({
  value: Schema.Finite,
  final: Schema.Boolean,
  as_of: Instant,
  at: Instant,
  run: Schema.String,
  says: Schema.optionalKey(Schema.String),
  opening: Schema.optionalKey(Schema.Literal(true)),
});

const FinalSchema = Schema.Struct({
  value: Schema.Finite,
  as_of: Instant,
  at: Instant,
  run: Schema.String,
  opening: Schema.optionalKey(Schema.Literal(true)),
});

const ChangeSchema = Schema.Literals(['passed', 'failed', 'overdue']);

const AssessmentStateSchema = Schema.Struct({
  pinned: Schema.optionalKey(PinnedRuleSchema),
  window: Schema.optionalKey(Schema.Struct({ opens: Instant, closes: Instant, due: Instant })),
  marks: Schema.Array(MarkSchema),
  measurement: Schema.optionalKey(StandingSchema),
  finalMeasurement: Schema.optionalKey(FinalSchema),
  lateMeasurement: Schema.optionalKey(FinalSchema),
  title: Schema.optionalKey(Schema.String),
  link: Schema.optionalKey(Schema.String),
  verdict: Schema.Literals(['open', 'passed', 'failed']),
  verdictAt: Schema.optionalKey(Instant),
  verdictBy: Schema.optionalKey(Schema.Literals(['crossing', 'final', 'deadline'])),
  overdueSince: Schema.optionalKey(Instant),
  ended: Schema.optionalKey(Schema.Literals(['no_result', 'goal_retired', 'playbook_retired'])),
  stopped: Schema.optionalKey(
    Schema.Struct({ at: Instant, run: Schema.String, reason: Schema.optionalKey(Schema.String) }),
  ),
  dismissed: Schema.optionalKey(
    Schema.Struct({
      at: Instant,
      by: Schema.Struct({ id: Schema.String, name: Schema.String }),
      requests: Schema.Array(Schema.String),
    }),
  ),
  sources: Schema.Array(Schema.String),
  owed: Schema.Array(Schema.Struct({ change: ChangeSchema, due: Instant, attempt: Schema.Int })),
  started: Schema.Array(Schema.Struct({ change: ChangeSchema, run: Schema.String })),
});

const StateTextSchema = Schema.fromJsonString(AssessmentStateSchema);

const stateOfText = Schema.decodeUnknownOption(StateTextSchema);

const textOfState = Schema.encodeSync(StateTextSchema);

export function assessmentStateText(state: AssessmentState): string {
  return textOfState(state);
}

export function assessmentStateOfText(text: unknown): AssessmentState | undefined {
  return Option.getOrUndefined(stateOfText(text));
}

export const NoticesStartedSchema = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ change: ChangeSchema, at: Schema.String, run: Schema.String })),
);

export type NoticesStarted = typeof NoticesStartedSchema.Type;

export const NoticeRefusalsSchema = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      change: Schema.Literals(['passed', 'failed', 'overdue', 'summary']),
      attempt: Schema.Int,
      detail: Schema.String,
      at: Schema.String,
      retry_at: Schema.optionalKey(Schema.String),
    }),
  ),
);

export type NoticeRefusals = typeof NoticeRefusalsSchema.Type;
