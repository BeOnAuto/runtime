import { heldGoalNamed, playbookGoalsIn } from '@on.auto/definitions/goals';
import { defineHttpOperation, NotFound, PlaybookReader, type PlaybookContext } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ClosedAssessmentSchema } from '../reads/assessments-schema.ts';
import { goalRowsOf } from './goal-rows.ts';
import {
  EndedOutcomeSchema,
  endedThat,
  mostOnAResultsPage,
  ResultsCursorSchema,
  resultsPageOf,
} from './result-pages.ts';

const description = [
  'Lists the results of one goal across every day, newest first,',
  `${String(mostOnAResultsPage)} a page, each with what it was judged on.`,
  '`outcome` keeps the results that ended one way, such as failed for the misses;',
  '`cursor` is the next_cursor of the page before.',
].join(' ');

const GoalResultsInput = Schema.Struct({
  goal: Schema.String.annotate({ description: 'The id of the goal' }),
  outcome: Schema.optionalKey(EndedOutcomeSchema),
  cursor: Schema.optionalKey(ResultsCursorSchema),
});

export type GoalResultsAsked = typeof GoalResultsInput.Type;

const GoalResultsSchema = Schema.Struct({
  items: Schema.Array(ClosedAssessmentSchema).annotate({
    description: `The results of the goal, newest first, at most ${String(mostOnAResultsPage)}`,
  }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor that reads the page after this one, null when nothing remains',
  }),
}).annotate({ description: 'A page of the results of a goal' });

type GoalResults = typeof GoalResultsSchema.Type;

export function goalResultsIn({
  goal,
  outcome,
  cursor,
}: GoalResultsAsked): Effect.Effect<GoalResults, NotFound, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const held = heldGoalNamed(yield* playbookGoalsIn, goal);
    if (held === undefined) {
      return yield* Effect.fail(new NotFound({ detail: `There is no goal ${goal} in this playbook` }));
    }
    const rows = goalRowsOf(yield* PlaybookReader, held);
    return yield* resultsPageOf(rows, [endedThat(outcome)], cursor);
  });
}

export const listGoalResults = defineHttpOperation('playbook', 'query', {
  name: 'list_goal_results',
  title: 'List goal results',
  description,
  route: { method: 'GET', path: '/goals/{goal}/results' },
  body: { kind: 'none' },
  inputSchema: GoalResultsInput,
  outputSchema: GoalResultsSchema,
  reasons: ['not_found', 'invalid_input'],
  handle: goalResultsIn,
});
