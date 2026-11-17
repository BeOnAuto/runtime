import { goalStandingIn } from '@on.auto/definitions/goals';
import {
  defineHttpOperation,
  NotFound,
  PlaybookReader,
  type PlaybookContext,
  type ProjectedCondition,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ClosedAssessmentSchema } from '../reads/assessments-schema.ts';
import { DaySchema, TimeZoneSchema } from './day-fields.ts';
import { goalRowsOf } from './goal-rows.ts';
import {
  EndedOutcomeSchema,
  endedThat,
  mostOnAResultsPage,
  ResultsCursorSchema,
  resultsPageOf,
} from './result-pages.ts';
import { zoneDayOf } from './zone-days.ts';

export const mostOnADayPage = mostOnAResultsPage;

const description = [
  'Reads the results of one goal that were judged on one day in a time zone, newest first,',
  `${String(mostOnADayPage)} a page, each with what it was judged on.`,
  '`outcome` keeps the results that ended one way; `cursor` is the next_cursor of the page before.',
].join(' ');

const GoalDayInput = Schema.Struct({
  goal: Schema.String.annotate({ description: 'The id of the goal' }),
  day: DaySchema.annotate({ description: 'The day, as YYYY-MM-DD in the time zone' }),
  time_zone: TimeZoneSchema.annotate({ description: 'The time zone the day is in' }),
  outcome: Schema.optionalKey(EndedOutcomeSchema),
  cursor: Schema.optionalKey(ResultsCursorSchema),
});

export type GoalDayAsked = typeof GoalDayInput.Type;

const GoalDaySchema = Schema.Struct({
  day: Schema.String.annotate({ description: 'The day, as YYYY-MM-DD in the time zone' }),
  time_zone: Schema.String.annotate({ description: 'The time zone the day is in' }),
  items: Schema.Array(ClosedAssessmentSchema).annotate({
    description: `The results judged that day, newest first, at most ${String(mostOnADayPage)}`,
  }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor that reads the page after this one, null when nothing remains',
  }),
}).annotate({ description: 'The results of a goal judged on one day' });

type GoalDay = typeof GoalDaySchema.Type;

export function goalDayIn({
  goal,
  day,
  time_zone: timeZone,
  outcome,
  cursor,
}: GoalDayAsked): Effect.Effect<GoalDay, NotFound, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const standing = yield* goalStandingIn;
    if (!standing.goals.some(({ id }) => id === goal)) {
      return yield* Effect.fail(new NotFound({ detail: `There is no goal ${goal} in this playbook` }));
    }
    const rows = goalRowsOf(yield* PlaybookReader, { id: goal });
    const { start, end } = zoneDayOf(timeZone, day);
    const where: readonly ProjectedCondition[] = [
      endedThat(outcome),
      { column: 'closed_at', after: start - 1 },
      { column: 'closed_at', before: end },
    ];
    const page = yield* resultsPageOf(rows, where, cursor);
    return { day, time_zone: timeZone, ...page };
  });
}

export const getGoalDay = defineHttpOperation('playbook', 'query', {
  name: 'get_goal_day',
  title: 'Get goal day',
  description,
  route: { method: 'GET', path: '/goals/{goal}/days/{day}' },
  body: { kind: 'none' },
  inputSchema: GoalDayInput,
  outputSchema: GoalDaySchema,
  reasons: ['not_found', 'invalid_input'],
  handle: goalDayIn,
});
