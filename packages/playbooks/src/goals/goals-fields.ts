import { Buffer } from 'node:buffer';

import { noticesFields, studioLinkField } from '@on.auto/operations';
import { Schema } from 'effect';

import { PlaybookSchema } from '../registry/playbook.ts';
import { GoalsAnswerSchema } from './goals-answer.ts';

export const mostGoalsBytes = 16_384;

const GoalsText = Schema.String.check(
  Schema.makeFilter((goals: string) => Buffer.byteLength(goals, 'utf8') <= mostGoalsBytes, {
    expected: `goals of at most ${mostGoalsBytes} bytes in UTF-8`,
    toJsonSchema: () => [{ maxLength: mostGoalsBytes }, true],
  }),
);

const goalsFieldWords =
  "The whole list of the playbook's goals as YAML text, as the goals guide says, in the person's words";

export function playbookGoalsFieldOf(messages: boolean) {
  return GoalsText.annotate({
    description: messages
      ? `${goalsFieldWords}: what it should achieve, how success is judged, and when and where to tell them`
      : `${goalsFieldWords}: what it should achieve and how success is judged`,
  });
}

export const beforeBuildingField = Schema.optionalKey(
  Schema.String.annotate({
    description:
      'What you must do before you build anything more, in words; present only when there is something to do',
  }),
);

export const PlaybookWithGoalsSchema = Schema.Struct({
  ...PlaybookSchema.fields,
  goals: GoalsAnswerSchema,
  before_building: beforeBuildingField,
}).annotate({ identifier: 'PlaybookWithGoals', description: 'A playbook of the org, with its goals' });

export type PlaybookWithGoals = typeof PlaybookWithGoalsSchema.Type;

const goalIdPattern = /^[a-z][a-z0-9-]{2,47}$/u;

export const GoalRenameField = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id the goal has now' }),
  new_id: Schema.String.annotate({
    description: 'The id to give it: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
  }).check(Schema.isPattern(goalIdPattern)),
}).annotate({
  description:
    "Gives one goal a new id; give it alone. To change what the goal is called, change its `name` in `goals` instead. The goal keeps its results and the person's yes, and each workflow that serves it is saved again with the new id",
});

const DefinitionSavedAgainSchema = Schema.Struct({
  type: Schema.String.annotate({ description: 'The type of the definition saved again' }),
  name: Schema.String.annotate({ description: 'The name of the definition saved again' }),
});

export const UpdatedPlaybookWithGoalsSchema = Schema.Struct({
  ...PlaybookWithGoalsSchema.fields,
  updated_definitions: Schema.optionalKey(
    Schema.Array(DefinitionSavedAgainSchema).annotate({
      description: "On a goal's rename, the workflows saved again with the new id, each by its `type` and `name`",
    }),
  ),
  ...noticesFields(),
}).annotate({
  identifier: 'UpdatedPlaybookWithGoals',
  description: 'A playbook just changed, with its goals',
});

export const CreatedPlaybookWithGoalsSchema = Schema.Struct({
  ...PlaybookWithGoalsSchema.fields,
  studio: studioLinkField('made'),
  ...noticesFields(),
}).annotate({
  identifier: 'CreatedPlaybookWithGoals',
  description: 'A playbook just created, with its goals and its page in Studio',
});
