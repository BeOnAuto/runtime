import { Schema } from 'effect';

export const mostInFlight = 12;

export const mostClosedShown = 60;

export const mostDismissedByBytes = 200;

const Instant = (description: string) => Schema.String.annotate({ description });

const Count = (description: string) => Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ description });

export const TargetSchema = Schema.Union([
  Schema.Struct({ at_least: Schema.Finite.annotate({ description: 'Passed at this number or more' }) }),
  Schema.Struct({ at_most: Schema.Finite.annotate({ description: 'Passed at this number or less' }) }),
]).annotate({ description: 'The number the measure is judged against' });

export const SettlesSchema = Schema.Literals(['on_crossing', 'at_close']).annotate({
  description: 'on_crossing, judged the moment a measurement crosses the target; at_close, judged at the end',
});

export const MilestoneSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the milestone' }),
  label: Schema.String.annotate({ description: 'The words for the milestone' }),
  by: Schema.Literals(['person', 'auto']).annotate({ description: 'Who marks it: the person or Auto' }),
}).annotate({ description: 'A moment that matters on the way' });

const SubjectSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the thing it is judged for' }),
  title: Schema.optionalKey(Schema.String.annotate({ description: 'The title of the thing' })),
  link: Schema.optionalKey(Schema.String.annotate({ description: 'An address of the thing' })),
}).annotate({ description: 'The one thing an assessment judges' });

const AssessmentWindowSchema = Schema.Struct({
  opens: Instant('When the window opens'),
  closes: Instant('When the window closes'),
  due: Instant('When the window is judged: its close plus the grace'),
}).annotate({ description: 'The window an assessment judges' });

const MarkSchema = Schema.Struct({
  milestone: Schema.String.annotate({ description: 'The id of the milestone marked' }),
  at: Instant('When it was first marked'),
  run: Schema.String.annotate({ description: 'The id of the run that marked it' }),
  says: Schema.optionalKey(Schema.String.annotate({ description: 'One sentence of evidence' })),
}).annotate({ description: 'The first mark of a milestone' });

const EndedMarkSchema = Schema.Struct({
  milestone: Schema.String.annotate({ description: 'The id of the milestone marked' }),
  at: Instant('When it was first marked'),
  run: Schema.String.annotate({ description: 'The id of the run that marked it' }),
}).annotate({ description: 'The first mark of a milestone' });

const MeasurementSchema = Schema.Struct({
  value: Schema.Finite.annotate({ description: 'The number' }),
  final: Schema.Boolean.annotate({ description: 'Whether the number will not change any more for its window' }),
  as_of: Instant('The moment the number is true through'),
  at: Instant('When the run that reported it ended'),
  run: Schema.String.annotate({ description: 'The id of the run that reported it' }),
  says: Schema.optionalKey(Schema.String.annotate({ description: 'One sentence of evidence' })),
}).annotate({ description: 'The standing measurement, the one with the latest as_of' });

const FinalMeasurementSchema = Schema.Struct({
  value: Schema.Finite.annotate({ description: 'The number' }),
  as_of: Instant('The moment the number is true through'),
  at: Instant('When the run that reported it ended'),
  run: Schema.String.annotate({ description: 'The id of the run that reported it' }),
}).annotate({
  description: "The latest final measurement true by the window's close, else the latest one that came after the close",
});

const StoppedSchema = Schema.Struct({
  at: Instant('When that run ended'),
  run: Schema.String.annotate({ description: 'The id of that run' }),
  reason: Schema.optionalKey(Schema.String.annotate({ description: "Why, in the run's words" })),
}).annotate({
  description: 'Set when a run ended without the result it needs; it stays open until judged at its due time',
});

const DismissedSchema = Schema.Struct({
  at: Instant('When it was dismissed'),
  by: Schema.String.annotate({
    description: `The id of the caller who dismissed it, cut to ${String(mostDismissedByBytes)} bytes`,
  }),
}).annotate({
  description:
    'Set on an open assessment someone dismissed; only a read asked with dismissed=include lists one. It is judged as before',
});

const JudgedBySchema = Schema.Literals(['crossing', 'final', 'deadline']).annotate({
  description:
    'How the verdict came: crossing, a measurement crossed the target; final, the final measurement decided, or one that came after the close and missed the target; deadline, the deadline passed with no final measurement that counts, so it failed; a final measurement that came after the close is its number',
});

const NoticeSchema = Schema.Struct({
  change: Schema.Literals(['passed', 'failed', 'overdue']).annotate({ description: 'What the notice told' }),
  at: Instant('When the notice started'),
  run: Schema.String.annotate({ description: 'The id of the run that sends it' }),
  delivered: Schema.optionalKey(
    Schema.Boolean.annotate({ description: 'Whether it was delivered; left out while it is still going' }),
  ),
}).annotate({ description: 'A notice sent of this assessment' });

export const AssessmentSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the assessment' }),
  per: Schema.optionalKey(SubjectSchema),
  window: Schema.optionalKey(AssessmentWindowSchema),
  rule: Schema.Struct({ settles: SettlesSchema, target: TargetSchema }).annotate({
    description: 'How it is judged, as pinned when it opened',
  }),
  milestones: Schema.Array(MilestoneSchema).annotate({ description: 'The milestones pinned when it opened' }),
  marks: Schema.Array(MarkSchema).annotate({ description: 'The milestones marked so far' }),
  next: Schema.optionalKey(Schema.String.annotate({ description: 'The first milestone not yet marked' })),
  measurement: Schema.optionalKey(MeasurementSchema),
  final_measurement: Schema.optionalKey(FinalMeasurementSchema),
  verdict: Schema.Literals(['open', 'passed', 'failed']).annotate({ description: 'open until it is judged' }),
  verdict_at: Schema.optionalKey(Instant('When it was judged')),
  verdict_by: Schema.optionalKey(JudgedBySchema),
  overdue_since: Schema.optionalKey(
    Instant('Since when it is overdue: its deadline passed with no final measurement that counts'),
  ),
  stopped: Schema.optionalKey(StoppedSchema),
  dismissed: Schema.optionalKey(DismissedSchema),
  goals_version: Schema.Int.annotate({ description: 'The version of the goals it opened under' }),
  notices: Schema.Array(NoticeSchema).annotate({ description: 'The notices sent of it' }),
}).annotate({ identifier: 'GoalAssessment', description: 'One judgement of a goal' });

export const ClosedAssessmentSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the assessment' }),
  outcome: Schema.Literals(['passed', 'failed', 'no_result']).annotate({
    description: 'How it ended; no_result only for what an earlier release ended with no result',
  }),
  by: Schema.optionalKey(JudgedBySchema),
  at: Instant('When it ended'),
  per: Schema.optionalKey(SubjectSchema),
  window: Schema.optionalKey(AssessmentWindowSchema),
  value: Schema.optionalKey(
    Schema.Finite.annotate({
      description:
        'The number it was judged on; for a miss at its deadline, the final measurement that came after the close, if one did',
    }),
  ),
  rule: Schema.optionalKey(
    Schema.Struct({ settles: SettlesSchema, target: TargetSchema }).annotate({
      description: 'How it was judged, as pinned when it opened',
    }),
  ),
  milestones: Schema.optionalKey(
    Schema.Array(MilestoneSchema).annotate({ description: 'The milestones pinned when it opened' }),
  ),
  marks: Schema.optionalKey(Schema.Array(EndedMarkSchema).annotate({ description: 'The milestones it had marked' })),
  measurement: Schema.optionalKey(MeasurementSchema),
  final_measurement: Schema.optionalKey(FinalMeasurementSchema),
}).annotate({ description: 'An assessment that ended' });

const DayCountSchema = Schema.Struct({
  day: Schema.String.annotate({ description: 'The day, as YYYY-MM-DD in the time zone asked' }),
  judged: Count('How many were judged that day'),
  passed: Count('How many of them passed'),
  says: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The sentence of evidence of the latest judged that day on its own measurement (a final one, or the one it crossed on); left out when none was',
    }),
  ),
}).annotate({ description: 'What was judged on one day' });

const JudgedDaysSchema = Schema.Struct({
  time_zone: Schema.String.annotate({ description: 'The time zone the days are counted in, as asked' }),
  counts: Schema.Array(DayCountSchema).annotate({
    description:
      'Newest first: each day of the range asked, empty days too, none before the first was judged; none when nothing was',
  }),
}).annotate({ description: 'What was judged each day; only when the read is asked with a time_zone' });

const LastPassedSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the assessment' }),
  at: Instant('When it passed'),
}).annotate({ description: 'The latest assessment that passed; left out when none ever did' });

const MissesSinceSchema = Schema.Struct({
  at: Instant('When the first of them ended'),
  count: Count('How many failed or ended with no result since the last pass'),
}).annotate({
  description:
    'The run of misses since the last pass, or since the first if none passed; left out when the latest that was judged passed',
});

export const AssessmentsSchema = Schema.Struct({
  current: Schema.NullOr(AssessmentSchema).annotate({
    description:
      'The newest open assessment that has an observation, else the newest closed, else the newest open; null when there is none',
  }),
  open_count: Count('How many assessments are open'),
  stopped_count: Schema.optionalKey(Count('How many open ones are stopped')),
  dismissed_count: Schema.optionalKey(
    Count(
      'How many open ones someone dismissed; the read leaves them out of every other open count and list unless asked with dismissed=include',
    ),
  ),
  in_flight: Schema.Array(AssessmentSchema).annotate({
    description: `The open assessments, at most ${String(mostInFlight)}: overdue first, then by due, then newest`,
  }),
  by_milestone: Schema.Record(Schema.String, Count('How many')).annotate({
    description: 'For each milestone, how many open assessments have it marked',
  }),
  waiting: Schema.Record(Schema.String, Count('How many')).annotate({
    description: 'For each milestone, how many open assessments wait on it next',
  }),
  closed: Schema.Struct({
    total: Count('How many assessments ended'),
    passed: Count('How many passed'),
    failed: Count('How many failed'),
    no_result: Count('How many ended with no result'),
    latest: Schema.Array(ClosedAssessmentSchema).annotate({
      description: `The latest that ended, at most ${String(mostClosedShown)}`,
    }),
    days: Schema.optionalKey(JudgedDaysSchema),
    last_passed: Schema.optionalKey(LastPassedSchema),
    misses_since: Schema.optionalKey(MissesSinceSchema),
  }).annotate({ description: 'The assessments that ended' }),
}).annotate({ description: 'How the goal is being judged' });

export type Assessments = typeof AssessmentsSchema.Type;

export const noAssessments: Assessments = {
  current: null,
  open_count: 0,
  stopped_count: 0,
  dismissed_count: 0,
  in_flight: [],
  by_milestone: {},
  waiting: {},
  closed: { total: 0, passed: 0, failed: 0, no_result: 0, latest: [] },
};
