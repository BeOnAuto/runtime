import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Option, Result } from 'effect';
import { describe } from 'vitest';

import { experiments, textOf } from './goal-examples.ts';
import { goalsDocumentOf } from './goals-check.ts';
import { GoalEventSchema, PlaybookGoalAgreementsEventSchema, PlaybookGoalsEventSchema } from './goals-facts.ts';

const ofThePlaybook = { at: '2026-11-09T10:00:00.000Z', by: 'key_7f3a' };

const source = textOf([experiments]);

const { goals } = Result.getOrThrow(goalsDocumentOf(source));

const saved = {
  type: 'playbook_goals_saved',
  data: { source, goals, version: 1 },
  context: ofThePlaybook,
} as const;

describe('the facts of the goals of a playbook, which a ledger keeps and this release no longer reads', () => {
  recordedFactsBehaviour({
    schema: PlaybookGoalsEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.57.0': [saved] },
  });
});

const ofThePerson = { at: '2026-11-13T10:00:00.000Z', by: 'person:user_2ada' };

const [agreedGoal] = goals;

const agreed = {
  type: 'playbook_goals_agreed',
  data: {
    agreements:
      agreedGoal === undefined ? [] : [{ goal: experiments.id, version: 1, ...ofThePerson, content: agreedGoal }],
  },
  context: ofThePerson,
} as const;

describe('the facts of the agreements to the goals of a playbook, which a ledger keeps and this release no longer reads', () => {
  recordedFactsBehaviour({
    schema: PlaybookGoalAgreementsEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.60.0': [agreed] },
  });
});

const goal = Option.getOrThrow(Option.fromNullishOr(agreedGoal));

const ofTheGoal = { ...ofThePlaybook, definitionId: '019a8f00-0000-7000-8000-000000000001' };

const ofTheGoalByThePerson = { ...ofThePerson, definitionId: ofTheGoal.definitionId };

describe('the facts of a goal', () => {
  recordedFactsBehaviour({
    schema: GoalEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.68.0': [
        { type: 'goal_created', data: { playbook: 'growth', position: 0, goal }, context: ofTheGoal },
        { type: 'goal_updated', data: { goal: { ...goal, retired: true } }, context: ofTheGoal },
        { type: 'goal_reordered', data: { position: 1 }, context: ofTheGoal },
        { type: 'goal_agreed', data: { version: 2 }, context: ofTheGoalByThePerson },
        { type: 'goal_removed', data: {}, context: ofTheGoal },
      ],
    },
  });
});
