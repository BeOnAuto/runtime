import {
  Caller,
  definitionOfStreamPrefix,
  PlaybookContext,
  playbookLedgerOf,
  type CallerIdentity,
  type PlaybookReader,
  type PlaybookWriter,
} from '@on.auto/operations';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import { Effect, Option, Result } from 'effect';

import { goalStream } from '../goals/goal-decider.ts';
import { textOf } from '../goals/goal-examples.ts';
import { goalsDocumentOf } from '../goals/goals-check.ts';
import type { GoalsDocument } from '../goals/goals-document.ts';
import { GoalEventSchema, type RecordedGoalEvent } from '../goals/goals-facts.ts';
import { definitionAndGoalNamesOf } from '../identity/names-of-a-playbook.ts';
import { acmeAdmin, savedIn } from './callers.ts';

export function goalsDocumentOfTheExamples(goals: readonly unknown[]): GoalsDocument {
  return Result.getOrThrow(goalsDocumentOf(textOf(goals)));
}

const factsFold = {
  initialState: [],
  evolve: (seen: readonly RecordedGoalEvent[], fact: RecordedGoalEvent) => [...seen, fact],
  eventSchema: GoalEventSchema,
};

type InThePlaybook = PlaybookReader | PlaybookWriter | PlaybookContext | Caller;

export function goalsBook() {
  const ledger = memoryLedgerWith({ definitionNames: definitionAndGoalNamesOf([]) });
  const as =
    (caller: CallerIdentity = acmeAdmin) =>
    <A, E>(effect: Effect.Effect<A, E, InThePlaybook>) =>
      Effect.runPromise(
        Effect.result(
          effect.pipe(
            Effect.provide(playbookLedgerOf(ledger.service, savedIn)),
            Effect.provideService(PlaybookContext, savedIn),
            Effect.provideService(Caller, caller),
          ),
        ),
      );
  const goalNames = () => ledger.names().filter(({ definitionType }) => definitionType === 'goal');
  const idOf = (name: string): string =>
    Option.getOrThrow(
      Option.flatMap(
        Option.fromNullishOr(goalNames().find((held) => held.name === name)?.definitionKey),
        definitionOfStreamPrefix,
      ),
    ).definition;
  const factsOfTheGoal = async (definition: string) =>
    (await Effect.runPromise(ledger.service.load(`definition/${savedIn.org}/${definition}/${goalStream}`, factsFold)))
      .state;
  return { as, goalNames, idOf, factsOfTheGoal, factsOf: (name: string) => factsOfTheGoal(idOf(name)) };
}
