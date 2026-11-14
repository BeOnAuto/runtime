import { Buffer } from 'node:buffer';

import { studioLinkField } from '@on.auto/operations';
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

export const CreatedPlaybookWithGoalsSchema = Schema.Struct({
  ...PlaybookWithGoalsSchema.fields,
  studio: studioLinkField('made'),
}).annotate({
  identifier: 'CreatedPlaybookWithGoals',
  description: 'A playbook just created, with its goals and its page in Studio',
});
