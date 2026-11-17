import { InvalidInput, type Notice, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { goalsAnswerOf, type GoalsKept } from '../goals/goals-answer.ts';
import type {
  CheckedGoal,
  CheckedGoals,
  GoalsSaveOutcome,
  GoalsSaving,
  PlaybookGoals,
  PlaybookHeld,
  PlaybookHeldSaved,
} from '../goals/playbook-goals.ts';
import type { PlaybookPages } from '../operations/playbook-pages.ts';
import { pagesInMemory } from './playbook-pages.ts';

export { noGoalGap } from '../plain-language/goals-words.ts';

export const refusedGoals = 'not goals';

export const goalsRefusedAtSave = '- id: left-out\n';

const goalsRefusal = new InvalidInput({
  detail: 'The goals have a problem',
  issues: [{ pointer: '/goals', detail: 'Line 1: the goals are a list of goals' }],
});

const savedGoalsRefusal = new InvalidInput({
  detail: 'These goals cannot replace the goals saved before',
  issues: [{ pointer: '', detail: 'The goal left-out has been judged and cannot be left out' }],
});

function keyOf({ org, playbook }: PlaybookAddress): string {
  return `${org}/${playbook}`;
}

const goalIdLine = '- id: ';

function goalIdsOf(source: string): readonly CheckedGoal[] {
  return source
    .split('\n')
    .flatMap((line) => (line.startsWith(goalIdLine) ? [{ id: line.slice(goalIdLine.length) }] : []));
}

export function goalsInMemory(
  pages: PlaybookPages = pagesInMemory(),
  messages = true,
  notices: readonly Notice[] = [],
): PlaybookGoals {
  const kept = new Map<string, GoalsKept>();
  const read = (address: PlaybookAddress): Effect.Effect<PlaybookHeld> =>
    Effect.map(pages.pageOf(address), (page) => ({
      ...(page === undefined ? {} : { page }),
      goals: goalsAnswerOf(kept.get(keyOf(address))),
    }));
  const goalsKept = (address: PlaybookAddress, { goals, onlyIfNone = false }: GoalsSaving<CheckedGoals>) =>
    Effect.sync((): GoalsSaveOutcome | undefined => {
      if (goals === undefined) {
        return undefined;
      }
      const before = kept.get(keyOf(address));
      if (before !== undefined && onlyIfNone) {
        return 'already_held';
      }
      if (before?.source === goals.source) {
        return 'unchanged';
      }
      kept.set(keyOf(address), { source: goals.source, version: (before?.version ?? 0) + 1 });
      return 'saved';
    });
  return {
    messages,
    check: (source) =>
      source === refusedGoals ? Effect.fail(goalsRefusal) : Effect.succeed({ source, goals: goalIdsOf(source) }),
    read,
    save: (address, saving) =>
      Effect.gen(function* () {
        if (saving.goals?.source === goalsRefusedAtSave) {
          return yield* savedGoalsRefusal;
        }
        if (saving.page !== undefined) {
          yield* pages.save(address, saving.page);
        }
        const outcome = yield* goalsKept(address, saving);
        const held = yield* read(address);
        const saved: PlaybookHeldSaved =
          outcome === undefined
            ? held
            : { ...held, outcome, awaiting: outcome === 'saved', ...(notices.length === 0 ? {} : { notices }) };
        return saved;
      }),
  };
}

export function cutOnce(goals: PlaybookGoals): PlaybookGoals {
  let cut = false;
  return {
    ...goals,
    save: (address, saving) => {
      if (cut) {
        return goals.save(address, saving);
      }
      cut = true;
      return Effect.die(new Error('The playbook could not be reached'));
    },
  };
}
