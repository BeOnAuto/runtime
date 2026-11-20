import { goalsDocumentOf } from '@on.auto/definitions/goals';
import { OrgContext } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { ActivityRow, GoalShown } from '../operations/activity-row.ts';
import { readsAtOnce } from '../operations/activity-tables.ts';
import type { GoalsRead } from './goal-set-aside.ts';

interface VerdictWords {
  readonly passed: string;
  readonly failed: string;
}

export type WordsOfGoals = ReadonlyMap<string, VerdictWords>;

export type WordsOfPlaybooks = ReadonlyMap<string, WordsOfGoals>;

const noWords: WordsOfGoals = new Map();

export function wordsIn(source?: string): WordsOfGoals {
  if (source === undefined) {
    return noWords;
  }
  return Result.match(goalsDocumentOf(source), {
    onSuccess: ({ goals }) => new Map(goals.map(({ id, success: { passed, failed } }) => [id, { passed, failed }])),
    onFailure: () => noWords,
  });
}

function wordsReadOf(goals: GoalsRead, org: string, playbook: string): Effect.Effect<readonly [string, WordsOfGoals]> {
  const wordsOfPlaybook = (words: WordsOfGoals): readonly [string, WordsOfGoals] => [playbook, words];
  return goals.read({ org, playbook }).pipe(
    Effect.map(({ goals: { source } }) => wordsIn(source)),
    Effect.catchCause(() => Effect.succeed(noWords)),
    Effect.map(wordsOfPlaybook),
  );
}

export function wordsOfRows(goals: GoalsRead, rows: readonly ActivityRow[]) {
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    const playbooks = [
      ...new Set(rows.filter(({ goal }) => goal !== undefined).map(({ position }) => position.playbook)),
    ];
    const words = yield* Effect.forEach(playbooks, (playbook) => wordsReadOf(goals, org, playbook), {
      concurrency: readsAtOnce,
    });
    const read: WordsOfPlaybooks = new Map(words);
    return read;
  });
}

export function wordOf(
  words: WordsOfPlaybooks,
  playbook: string,
  goal: string,
  outcome: GoalShown['outcome'],
): string | null {
  const said = words.get(playbook)?.get(goal);
  if (said === undefined || outcome === 'overdue') {
    return null;
  }
  return said[outcome];
}
