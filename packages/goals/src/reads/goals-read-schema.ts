import { WeekdaySchema } from '@on.auto/definitions/goals';
import { GoalGapSchema } from '@on.auto/playbooks';
import { Schema } from 'effect';

import { DaySchema, TimeZoneSchema } from '../results/day-fields.ts';
import { defaultDays, mostDays } from '../results/judged-days.ts';
import { AssessmentsSchema, MilestoneSchema, SettlesSchema, TargetSchema } from './assessments-schema.ts';

const ToldSchema = Schema.Literals(['now', 'summary', 'quiet']).annotate({
  description: 'now, at once; summary, in the summary; quiet, not at all',
});

const Duration = (description: string) => Schema.String.annotate({ description });

const AfterWindowSchema = Schema.Struct({
  after: Schema.String.annotate({ description: 'The milestone whose first mark starts the window' }),
  for: Duration('How long after its start the window closes'),
  grace: Schema.optionalKey(Duration('How long after the close a final measurement may still arrive')),
}).annotate({ description: 'A window that starts when a milestone is first marked' });

const CalendarWindowSchema = Schema.Struct({
  calendar: Schema.Literals(['day', 'week', 'month']).annotate({ description: 'The unit of the calendar' }),
  time_zone: Schema.optionalKey(Schema.String.annotate({ description: 'The time zone of the calendar' })),
  grace: Schema.optionalKey(Duration('How long after the close a final measurement may still arrive')),
  days: Schema.optionalKey(
    Schema.Array(WeekdaySchema).annotate({
      description: 'The days of the week a daily window is judged on, every day when left out',
    }),
  ),
}).annotate({ description: 'A window of the calendar' });

const SuccessSchema = Schema.Struct({
  label: Schema.String.annotate({ description: 'The words for the number' }),
  settles: SettlesSchema,
  target: TargetSchema,
  passed: Schema.String.annotate({ description: 'The words for a pass' }),
  failed: Schema.String.annotate({ description: 'The words for a fail' }),
}).annotate({ description: 'What counts as success' });

const NotifySchema = Schema.Struct({
  passed: ToldSchema,
  failed: ToldSchema,
  overdue: Schema.optionalKey(ToldSchema),
  through: Schema.optionalKey(Schema.String.annotate({ description: 'The notification function that tells' })),
  summary: Schema.optionalKey(
    Schema.Struct({
      cron: Schema.String.annotate({ description: 'When the summary comes' }),
      time_zone: Schema.optionalKey(Schema.String.annotate({ description: 'The time zone of its schedule' })),
      through: Schema.optionalKey(Schema.String.annotate({ description: 'The notification function that sends it' })),
    }).annotate({ description: 'The summary and when it comes' }),
  ),
}).annotate({ description: 'How the owner asked to be told, absent when they chose nothing, so nothing is owed' });

const ContributionSchema = Schema.Struct({
  workflow: Schema.String.annotate({ description: 'The name of the workflow' }),
  purpose: Schema.String.annotate({ description: "What it does for the goal, in the owner's words" }),
  marks: Schema.optionalKey(Schema.String.annotate({ description: 'The milestone it marks' })),
  measures: Schema.Boolean.annotate({ description: 'Whether it reports the measure' }),
}).annotate({ description: 'What one workflow does for the goal' });

const ConnectionSchema = Schema.Struct({
  server: Schema.String.annotate({ description: 'The name a function gives the server in server/tool' }),
  name: Schema.String.annotate({ description: 'The name to show the person' }),
  connected: Schema.Boolean.annotate({
    description:
      'true when it is connected and offered to this playbook, false when the person still has to connect it',
  }),
  workflows: Schema.Array(Schema.String).annotate({ description: 'The workflows of the goal that use it' }),
}).annotate({ description: 'A tool server the goal needs' });

export const AgreedSchema = Schema.Struct({
  at: Schema.String.annotate({ description: 'When the yes was recorded' }),
  by: Schema.String.annotate({ description: 'The id of the caller that recorded it' }),
  version: Schema.Int.annotate({ description: 'The version of the goals the person said yes to' }),
}).annotate({ description: "The person's yes to the goal as it is saved now" });

const GoalReadSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the goal' }),
  name: Schema.optionalKey(Schema.String.annotate({ description: "The goal's short name, in the owner's words" })),
  statement: Schema.String.annotate({ description: "The goal in the owner's words" }),
  per: Schema.optionalKey(Schema.String.annotate({ description: 'What it is judged per' })),
  window: Schema.optionalKey(
    Schema.Union([AfterWindowSchema, CalendarWindowSchema]).annotate({ description: 'The window it is judged in' }),
  ),
  success: SuccessSchema,
  milestones: Schema.Array(MilestoneSchema).annotate({ description: 'The moments that matter, in order' }),
  notify: Schema.optionalKey(NotifySchema),
  retired: Schema.optionalKey(Schema.Boolean.annotate({ description: 'true when the goal is stopped' })),
  agreed: Schema.optionalKey(
    AgreedSchema.annotate({
      description:
        "The person's yes to the goal as it is saved now; left out until they say yes, and again once the goal changes",
    }),
  ),
  gaps: Schema.Array(GoalGapSchema).annotate({ description: 'What the goal still lacks' }),
  contributions: Schema.Array(ContributionSchema).annotate({
    description: 'What the workflows that are not retired do for it',
  }),
  connections: Schema.optionalKey(
    Schema.Array(ConnectionSchema).annotate({
      description:
        "The tool servers the goal's workflows and the functions they call use, each with whether it is connected; one that is not connected is also a connection_missing gap",
    }),
  ),
  assessments: AssessmentsSchema,
}).annotate({
  identifier: 'GoalRead',
  description: 'A goal as written, what it lacks, what serves it and how it is judged',
});

export const GoalsReadSchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: 'The version of the goals, 0 when the playbook has none',
  }),
  gaps: Schema.Array(GoalGapSchema).annotate({ description: 'What the playbook itself still lacks' }),
  goals: Schema.Array(GoalReadSchema).annotate({ description: 'The goals, in the order they were written' }),
  results: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'true where the runtime judges the goals, false where it keeps them and judges nothing yet',
    }),
  ),
}).annotate({ identifier: 'GoalsRead', description: 'The goals of the playbook and how each is being judged' });

export type GoalsRead = typeof GoalsReadSchema.Type;

export type GoalRead = GoalsRead['goals'][number];

export const GoalsQuerySchema = Schema.Struct({
  time_zone: Schema.optionalKey(
    TimeZoneSchema.annotate({
      description: "The time zone to count each goal's judged results by day in; without it no days are counted",
    }),
  ),
  days: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostDays })).annotate({
      description: `How many days to count, from 1 to ${String(mostDays)}; ${String(defaultDays)} when left out`,
    }),
  ),
  until: Schema.optionalKey(
    DaySchema.annotate({
      description: 'The newest day to count, as YYYY-MM-DD; today in the time zone when left out',
    }),
  ),
  dismissed: Schema.optionalKey(
    Schema.Literal('include').annotate({
      description:
        'include to read the open assessments someone dismissed too, each with dismissed; left out of the read when this is left out',
    }),
  ),
});
