import { Schema } from 'effect';

import { ActivityCountsSchema } from '../operations/activity-counts.ts';
import { kindsInWords } from '../operations/activity-input.ts';
import { ListActivityInputSchema } from '../operations/activity-input.ts';
import { ActivityRowSchema, activityKinds, type ActivityKind } from '../operations/activity-row.ts';
import { ThroughSchema } from '../operations/activity-viewer.ts';
import { MarkActivitySeenInputSchema } from '../operations/mark-activity-seen.ts';

export const kindsWithGoals: readonly ActivityKind[] = [...activityKinds, 'goal', 'goal_overdue'];

export const seenKindsWithGoals: ReadonlySet<ActivityKind> = new Set(['new', 'comment', 'goal']);

const NullableText = (description: string) => Schema.NullOr(Schema.String).annotate({ description });

const ActivityRowWithGoalsSchema = Schema.Struct({
  ...ActivityRowSchema.fields,
  kind: Schema.Literals(kindsWithGoals).annotate({ description: kindsInWords(kindsWithGoals) }),
  by: Schema.String.annotate({
    description:
      'The id of the caller who started the run, saved the version or changed the playbook; for a request, who started the run that asked; for a comment, who made it; for goal, who judged it, and for goal_overdue, the playbook',
  }),
  seen: Schema.NullOr(Schema.Boolean).annotate({
    description: 'For new, comment and goal, whether the caller has seen it; null for the other kinds',
  }),
  goal: NullableText('For goal and goal_overdue, the id of the goal the assessment judges; otherwise null'),
  outcome: Schema.NullOr(Schema.Literals(['passed', 'failed', 'overdue'])).annotate({
    description: 'For goal, passed or failed, and for goal_overdue, overdue; otherwise null',
  }),
  word: NullableText("For goal, the goal's own words for its verdict, as its goals say them now; otherwise null"),
  title: NullableText(
    'For goal and goal_overdue, the title of the thing the assessment judges, where an observation gave one; otherwise null',
  ),
  says: NullableText(
    'For goal and goal_overdue, the latest sentence of evidence an observation gave before the verdict; otherwise null',
  ),
  result_at: NullableText(
    'For goal, the time its verdict names, which can come before at, when the verdict was recorded; for goal_overdue, the time it became overdue, as at; in ISO 8601 UTC; otherwise null',
  ),
  dismissed: Schema.optionalKey(
    Schema.Struct({
      goal: Schema.String.annotate({ description: 'The id of the goal of the dismissed thing' }),
      id: Schema.String.annotate({ description: 'The id of the dismissed thing' }),
      at: Schema.String.annotate({ description: 'When it was dismissed, in ISO 8601 UTC' }),
      by: Schema.String.annotate({ description: 'The id of the caller who dismissed it' }),
    }).annotate({
      description:
        'For a needs_you row of a list asked with dismissed=include, the dismissed thing this request was waiting on when it was dismissed, by the goal and id dismiss_goal_thing takes to restore the thing',
    }),
  ),
}).annotate({ identifier: 'ActivityRow', description: 'An item of the activity of the org' });

export type ServedActivityRowWithGoals = typeof ActivityRowWithGoalsSchema.Type;

const ActivityCountsWithGoalsSchema = Schema.Struct({
  ...ActivityCountsSchema.fields,
  needs_you: Schema.Int.annotate({
    description:
      'The requests that wait on the caller, leaving out those that were waiting on a thing of a goal when it was dismissed, whether or not the list asked for dismissed=include',
  }),
  goals: Schema.Int.annotate({
    description: 'The verdicts of goals the caller has not seen and the overdues of goals still open',
  }),
}).annotate({ description: 'What the caller has to look at, over every playbook the caller may access' });

export type ActivityCountsWithGoals = typeof ActivityCountsWithGoalsSchema.Type;

export const ListActivityWithGoalsInputSchema = Schema.Struct({
  ...ListActivityInputSchema.fields,
  kind: Schema.optionalKey(
    Schema.String.annotate({
      description: `One kind, ${kindsInWords(kindsWithGoals)}, or several separated by commas: keep the rows of those kinds`,
    }),
  ),
  dismissed: Schema.optionalKey(
    Schema.Literal('include').annotate({
      description:
        'include to also list the needs_you rows of the requests that were waiting on a thing of a goal when it was dismissed, each with dismissed naming the thing. Left out, they are left out, as Studio leaves them out.',
    }),
  ),
});

export const ListActivityWithGoalsOutputSchema = Schema.Struct({
  rows: Schema.Array(ActivityRowWithGoalsSchema).annotate({
    description: 'The rows of the page, newest first by at, and rows of the same at newest first by result_at',
  }),
  has_more: Schema.Boolean.annotate({ description: 'Whether more rows follow this page' }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor to pass as cursor for the next page, or null after the last',
  }),
  counts: ActivityCountsWithGoalsSchema,
  through: ThroughSchema,
});

export const MarkActivitySeenWithGoalsInputSchema = Schema.Struct({
  ...MarkActivitySeenInputSchema.fields,
  items: Schema.optionalKey(
    MarkActivitySeenInputSchema.fields.items.schema.annotate({
      description:
        'The new, comment and goal rows the caller has seen, each its address and its at, at most 200; a goal row is marked by the address of its assessment',
    }),
  ),
});

export const MarkActivitySeenWithGoalsOutputSchema = Schema.Struct({
  counts: ActivityCountsWithGoalsSchema,
  through: ThroughSchema,
});
