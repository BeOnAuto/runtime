import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result } from 'effect';
import { describe } from 'vitest';

import { experiments, textOf } from './goal-examples.ts';
import { goalsDocumentOf } from './goals-check.ts';
import { GoalAgreementsEventSchema, GoalsEventSchema } from './goals-facts.ts';

const ofThePlaybook = { at: '2026-11-09T10:00:00.000Z', by: 'key_7f3a' };

const source = textOf([experiments]);

const { goals } = Result.getOrThrow(goalsDocumentOf(source));

const saved = {
  type: 'playbook_goals_saved',
  data: { source, goals, version: 1 },
  context: ofThePlaybook,
} as const;

describe('the facts of the goals of a playbook', () => {
  recordedFactsBehaviour({
    schema: GoalsEventSchema,
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

describe('the facts of the agreements to the goals of a playbook', () => {
  recordedFactsBehaviour({
    schema: GoalAgreementsEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.60.0': [agreed] },
  });
});
