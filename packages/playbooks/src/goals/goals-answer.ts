import { Schema } from 'effect';

import { noGoalGap } from '../plain-language/goals-words.ts';

export const gapKinds = [
  'no_goal',
  'no_milestones',
  'measure_unreported',
  'measure_paused',
  'measure_never_final',
  'milestone_unmarked',
  'window_never_starts',
  'workflow_without_contribution',
  'contribution_orphaned',
  'notice_function_missing',
  'notice_not_started',
  'notice_undelivered',
  'observation_refused',
] as const;

export const GoalGapSchema = Schema.Struct({
  kind: Schema.Literals(gapKinds).annotate({ description: 'What the goals still lack' }),
  goal: Schema.optionalKey(Schema.String.annotate({ description: 'The id of the goal it is about' })),
  workflow: Schema.optionalKey(Schema.String.annotate({ description: 'The name of the workflow it is about' })),
  detail: Schema.String.annotate({ description: 'What is missing, in words' }),
  fixed_by: Schema.Literals(['person', 'agent']).annotate({
    description: 'person when only the person can answer it, agent when the agent can put it right',
  }),
  ask: Schema.optionalKey(Schema.String.annotate({ description: 'The question to ask the person' })),
}).annotate({ identifier: 'GoalGap', description: 'Something the goals still lack before they can be judged or told' });

export type GoalGap = typeof GoalGapSchema.Type;

export const GoalsAnswerSchema = Schema.Struct({
  source: Schema.optionalKey(Schema.String.annotate({ description: 'The goals as they were saved' })),
  version: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: 'The version of the goals, from 1' }),
  ),
  gaps: Schema.Array(GoalGapSchema).annotate({ description: 'What the playbook and its goals still lack' }),
}).annotate({
  identifier: 'PlaybookGoals',
  description: "The playbook's goals, where it has them, and what they still lack",
});

export type GoalsAnswer = typeof GoalsAnswerSchema.Type;

export interface GoalsKept {
  readonly source: string;
  readonly version: number;
}

export function goalsAnswerOf(kept: GoalsKept | undefined): GoalsAnswer {
  return kept === undefined ? { gaps: [noGoalGap] } : { source: kept.source, version: kept.version, gaps: [] };
}
