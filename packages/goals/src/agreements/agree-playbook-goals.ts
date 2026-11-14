import { agreementStanding, playbookGoalsAgreed, type GoalsAgreed } from '@on.auto/definitions/goals';
import { defineCommand } from '@on.auto/operations';
import { beforeBuildingAfterAgreeOf, beforeBuildingField, goalsSavedWordsOf } from '@on.auto/playbooks';
import { Effect, Schema } from 'effect';

import { AgreedSchema } from '../reads/goals-read-schema.ts';

const description = [
  "Records the person's yes to the playbook's saved goals.",
  'Call it only after the person says yes in the conversation, and send the goals `version` they saw.',
  'Without `ids` it covers every goal that is not retired.',
  'A goal saved again with a change needs a new yes: show it, ask again, then call this again.',
].join(' ');

const AgreePlaybookGoalsInputSchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: 'The goals version the person saw, as create_playbook, update_playbook or get_playbook answered it',
  }),
  ids: Schema.optionalKey(
    Schema.Array(Schema.String).check(Schema.isMinLength(1)).annotate({
      description: 'The ids of the goals the person said yes to; leave it out for every goal that is not retired',
    }),
  ),
});

const AgreedGoalSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the goal' }),
  agreed: Schema.optionalKey(AgreedSchema),
});

const GoalsAgreedSchema = Schema.Struct({
  version: Schema.Int.annotate({ description: 'The version of the goals now' }),
  goals: Schema.Array(AgreedGoalSchema).annotate({
    description: 'The goals that are not retired, in order; one with no agreed still needs a yes',
  }),
  before_building: beforeBuildingField,
}).annotate({ identifier: 'GoalsAgreed', description: 'The goals and the yes recorded to each' });

type GoalsAgreedRead = typeof GoalsAgreedSchema.Type;

function agreedReadOf({ goals, agreements }: GoalsAgreed): GoalsAgreedRead {
  return {
    version: goals.version,
    goals: goals.goals
      .filter(({ retired }) => retired !== true)
      .map((goal) => {
        const agreement = agreementStanding(goal, agreements);
        if (agreement === undefined) {
          return { id: goal.id };
        }
        const { at, by, version } = agreement;
        return { id: goal.id, agreed: { at, by, version } };
      }),
  };
}

function withBeforeBuilding(read: GoalsAgreedRead, messages: boolean): GoalsAgreedRead {
  const before = beforeBuildingAfterAgreeOf(messages);
  return before === undefined ? read : { ...read, before_building: before };
}

function waitingOf({ goals }: GoalsAgreedRead): readonly string[] {
  return goals.filter(({ agreed }) => agreed === undefined).map(({ id }) => id);
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
      attempt: ({ version }) => `record the person's yes to version ${String(version)} of the goals`,
      outcome: (agreed) => {
        const waiting = waitingOf(agreed);
        const recorded = `Recorded the person's yes to version ${String(agreed.version)} of the goals.`;
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
