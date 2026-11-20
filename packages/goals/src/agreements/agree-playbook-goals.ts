import { playbookGoalsAgreed, type PlaybookGoals } from '@on.auto/definitions/goals';
import { defineCommand } from '@on.auto/operations';
import { listed } from '@on.auto/phrasing';
import { beforeBuildingAfterAgreeOf, beforeBuildingField, goalsSavedWordsOf } from '@on.auto/playbooks';
import { Effect, Schema } from 'effect';

import { AgreedSchema } from '../reads/goals-read-schema.ts';

const description = [
  "Records the person's yes to the playbook's saved goals.",
  "Call it only after the person says yes in the conversation, and send each goal's `id` with the `version` they saw.",
  'Name every goal they said yes to; one you leave out keeps waiting for its yes.',
  'A goal saved again with a change needs a new yes: show it, ask again, then call this again.',
].join(' ');

const GoalSeenSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the goal' }),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: 'The version of the goal the person saw',
  }),
});

const AgreePlaybookGoalsInputSchema = Schema.Struct({
  goals: Schema.Array(GoalSeenSchema).check(Schema.isMinLength(1)).annotate({
    description:
      'The goals the person said yes to, each by its `id` and the `version` they saw, as create_playbook, update_playbook or get_playbook answered it',
  }),
});

const AgreedGoalSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the goal' }),
  version: Schema.Int.annotate({ description: 'The version of the goal now' }),
  agreed: Schema.optionalKey(AgreedSchema),
});

const GoalsAgreedSchema = Schema.Struct({
  goals: Schema.Array(AgreedGoalSchema).annotate({
    description: 'The goals that are not retired, in order; one with no agreed still needs a yes',
  }),
  before_building: beforeBuildingField,
}).annotate({ identifier: 'GoalsAgreed', description: 'The goals and the yes recorded to each' });

type GoalsAgreedRead = typeof GoalsAgreedSchema.Type;

function agreedReadOf({ held }: PlaybookGoals): GoalsAgreedRead {
  return {
    goals: held
      .filter(({ goal }) => goal.retired !== true)
      .map(({ goal, version, agreed }) =>
        agreed === undefined ? { id: goal.id, version } : { id: goal.id, version, agreed },
      ),
  };
}

function withBeforeBuilding(read: GoalsAgreedRead, messages: boolean): GoalsAgreedRead {
  const before = beforeBuildingAfterAgreeOf(messages);
  return before === undefined ? read : { ...read, before_building: before };
}

function waitingOf({ goals }: GoalsAgreedRead): readonly string[] {
  return goals.filter(({ agreed }) => agreed === undefined).map(({ id }) => id);
}

function goalsNamed(goals: readonly { readonly id: string }[]): string {
  const ids = [...new Set(goals.map(({ id }) => id))];
  const [only] = ids;
  return ids.length === 1 && only !== undefined ? `the goal ${only}` : `the goals ${listed(ids)}`;
}

function agreePlaybookGoalsTold(messages: boolean) {
  return defineCommand('playbook', {
    name: 'agree_playbook_goals',
    title: 'Agree playbook goals',
    description,
    route: { method: 'POST', path: '/goals/agreed' },
    repeatable: true,
    inputSchema: AgreePlaybookGoalsInputSchema,
    outputSchema: GoalsAgreedSchema,
    reasons: ['invalid_input', 'conflict'],
    handle: (agreeing) =>
      Effect.map(playbookGoalsAgreed(agreeing), (agreed) => withBeforeBuilding(agreedReadOf(agreed), messages)),
    plainLanguage: {
      task: "record the person's yes to the goals",
      attempt: ({ goals }) => `record the person's yes to ${goalsNamed(goals)}`,
      outcome: (agreed, { goals }) => {
        const waiting = waitingOf(agreed);
        const recorded = `Recorded the person's yes to ${goalsNamed(goals)}.`;
        const words = waiting.length === 0 ? recorded : `${recorded} Still waiting for a yes: ${waiting.join(', ')}.`;
        return `${words}${goalsSavedWordsOf(messages)}`;
      },
    },
  });
}

export const agreePlaybookGoals = agreePlaybookGoalsTold(true);

const agreePlaybookGoalsUntold = agreePlaybookGoalsTold(false);

export function agreePlaybookGoalsWhere(messages: boolean) {
  return messages ? agreePlaybookGoals : agreePlaybookGoalsUntold;
}
