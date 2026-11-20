import { heldGoalNamed, playbookGoalsIn, type HeldGoal } from '@on.auto/definitions/goals';
import {
  Caller,
  defineCommand,
  NotFound,
  PlaybookReader,
  PlaybookWriter,
  recordedCallerOf,
  withNotices,
  noticesFields,
  type Decider,
  type PlaybookContext,
} from '@on.auto/operations';
import { DateTime, Effect, Result, Schema } from 'effect';

import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { factsDismissing, type Dismissing } from '../assessments/dismissing.ts';
import { AssessmentEventSchema, assessmentsKind, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';
import { dismissalNoticesOf, isJudged, restoring } from './dismissal-notices.ts';
import { dismissedLatelyBefore } from './dismissed-lately.ts';

export interface ThingOfAGoal {
  readonly goal: string;
  readonly id: string;
}

export type AskedAbout = (
  thing: ThingOfAGoal,
) => Effect.Effect<readonly string[], never, PlaybookReader | PlaybookContext>;

const description = [
  "Dismisses a thing of a goal for everyone in the organization: it leaves its goal's Outstanding in Studio, and list_interactions lists its requests only with dismissed: include.",
  "Call it only when the person clearly says a thing no longer needs them, by the goal and id from a request's about in list_interactions.",
  'If their words could be an answer, a correction or a cancel, as "ignore it" or "forget it" can, ask first if it no longer needs them; answers go to answer_interaction.',
  'Asking for several, even "all of them", is not a yes: name each and wait for a yes.',
  'It answers and cancels nothing: requests wait until they expire; the thing is still judged and counts.',
  `To ${restoring.restore('the thing')}, send dismissed: false; a thing.dismissed event or list_interactions with dismissed: include has goal and id.`,
].join(' ');

const DismissGoalThingInputSchema = Schema.Struct({
  goal: Schema.String.annotate({
    description: "The id of the goal, from a request's about in list_interactions or a thing.dismissed event",
  }),
  id: Schema.String.check(Schema.isUUID()).annotate({
    description:
      "The id of the thing, not its per, from a request's about in list_interactions or a thing.dismissed event",
  }),
  dismissed: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: `true, or left out, to dismiss the thing; false to ${restoring.restore('a dismissed thing')}`,
    }),
  ),
});

const DismissedBySchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the member who dismissed it' }),
  name: Schema.String.annotate({ description: 'Their name' }),
});

const GoalThingDismissedSchema = Schema.Struct({
  goal: Schema.String.annotate({ description: 'The id of the goal' }),
  id: Schema.String.annotate({ description: 'The id of the thing' }),
  per: Schema.optionalKey(Schema.String.annotate({ description: 'The id of the thing in its own words' })),
  dismissed: Schema.Boolean.annotate({ description: 'Whether the thing is dismissed now' }),
  at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When it was dismissed, in ISO 8601 UTC; present while dismissed' }),
  ),
  by: Schema.optionalKey(DismissedBySchema.annotate({ description: 'Who dismissed it; present while dismissed' })),
  open: Schema.Boolean.annotate({ description: 'true while the thing waits for its result' }),
  questions_set_aside: Schema.Int.annotate({
    description: 'How many questions waiting on the thing its dismissal set aside; 0 while not dismissed',
  }),
  ...noticesFields(),
}).annotate({ identifier: 'GoalThingDismissed', description: 'A thing of a goal, dismissed or not' });

type GoalThingDismissed = typeof GoalThingDismissedSchema.Type;

const assessmentFold = {
  initialState: unopened,
  evolve: (state: AssessmentState, fact: RecordedAssessmentEvent) => assessmentAfter(state, fact),
  eventSchema: AssessmentEventSchema,
};

function dismissingOf({ definition, goal }: HeldGoal): Decider<AssessmentState, Dismissing, RecordedAssessmentEvent> {
  return {
    ...assessmentFold,
    decide: (asked, state) => Result.succeed(factsDismissing(state, asked)),
    context: ({ at, by }) => ({
      at: new Date(at).toISOString(),
      by: by.id,
      definitionId: definition,
      definitionName: goal.id,
    }),
  };
}

function streamOf(id: string): string {
  return `${assessmentsKind}/${id}`;
}

function dismissedOf(goal: string, id: string, state: AssessmentState): GoalThingDismissed {
  const per = state.pinned?.per;
  const { dismissed } = state;
  return {
    goal,
    id,
    ...(per === undefined ? {} : { per }),
    dismissed: dismissed !== undefined,
    ...(dismissed === undefined
      ? {}
      : { at: new Date(dismissed.at).toISOString(), by: { id: dismissed.by.id, name: dismissed.by.name } }),
    open: !isJudged(state),
    questions_set_aside: dismissed?.requests.length ?? 0,
  };
}

const thingIn = Effect.fnUntraced(function* ({ goal, id }: ThingOfAGoal) {
  const held = heldGoalNamed(yield* playbookGoalsIn, goal);
  if (held === undefined) {
    return yield* Effect.fail(new NotFound({ detail: `There is no goal ${goal} in this playbook` }));
  }
  const { state } = yield* (yield* PlaybookReader).ofDefinition(held.definition).load(streamOf(id), assessmentFold);
  if (state.pinned === undefined) {
    return yield* Effect.fail(new NotFound({ detail: `The goal ${goal} has no thing with the id ${id}` }));
  }
  return { held, state };
});

function requestsOf(
  askedAbout: AskedAbout | undefined,
  thing: ThingOfAGoal,
  dismissed: boolean,
  state: AssessmentState,
): Effect.Effect<readonly string[], never, PlaybookReader | PlaybookContext> {
  return askedAbout === undefined || !dismissed || state.dismissed !== undefined
    ? Effect.succeed([])
    : askedAbout(thing);
}

function handledWith(askedAbout: AskedAbout | undefined) {
  return Effect.fnUntraced(function* ({ goal, id, dismissed = true }: typeof DismissGoalThingInputSchema.Type) {
    const thing = { goal, id };
    const { held, state: before } = yield* thingIn(thing);
    const requests = yield* requestsOf(askedAbout, thing, dismissed, before);
    const caller = yield* Caller;
    const at = DateTime.toEpochMillis(yield* DateTime.now);
    const by = recordedCallerOf(caller);
    const writer = (yield* PlaybookWriter).ofDefinition(held.definition);
    const { state, decidedOn } = yield* writer.execute(streamOf(id), dismissingOf(held), {
      dismissed,
      at,
      by,
      requests,
    });
    const answer = dismissedOf(goal, id, state);
    const { dismissed: standing } = state;
    if (standing === undefined || decidedOn.dismissed !== undefined) {
      return answer;
    }
    const others = yield* dismissedLatelyBefore({ id, by: by.id, at });
    return withNotices(answer, dismissalNoticesOf(state, standing, others));
  });
}

function thingInWords({ id, per }: Pick<GoalThingDismissed, 'id' | 'per'>): string {
  return per ?? id;
}

export function dismissGoalThingAsking(askedAbout?: AskedAbout) {
  return defineCommand('playbook', {
    name: 'dismiss_goal_thing',
    title: 'Dismiss a thing of a goal',
    description,
    route: { method: 'PUT', path: '/goals/{goal}/things/{id}/dismissed' },
    repeatable: true,
    inputSchema: DismissGoalThingInputSchema,
    outputSchema: GoalThingDismissedSchema,
    reasons: ['not_found', 'invalid_input', 'conflict'],
    handle: handledWith(askedAbout),
    plainLanguage: {
      task: 'dismiss a thing of a goal',
      attempt: ({ goal, id, dismissed = true }) =>
        dismissed ? `dismiss ${id} of the goal ${goal}` : `${restoring.restore(id)} of the goal ${goal}`,
      outcome: (answer) =>
        answer.dismissed
          ? `Dismissed ${thingInWords(answer)} of the goal ${answer.goal} for everyone in the organization.`
          : `${restoring.done} ${thingInWords(answer)} of the goal ${answer.goal}.`,
    },
  });
}
