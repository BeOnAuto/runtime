import { Effect } from 'effect';

import { isoOf, servedRow, type ActivityRow, type GoalShown } from '../operations/activity-row.ts';
import { isSeenBy, type Viewer } from '../operations/activity-viewer.ts';
import { seenKindsWithGoals, type ServedActivityRowWithGoals } from './goal-schemas.ts';
import { wordOf, wordsOfRows, type GoalsRead, type WordsOfPlaybooks } from './goal-words.ts';

const noGoal = { goal: null, outcome: null, word: null, title: null, says: null, result_at: null };

function goalFieldsOf(playbook: string, goal: GoalShown | undefined, words: WordsOfPlaybooks) {
  if (goal === undefined) {
    return noGoal;
  }
  const { resultAt, ...shown } = goal;
  return { ...shown, word: wordOf(words, playbook, goal), result_at: isoOf(resultAt) };
}

function servedWithGoals(row: ActivityRow, viewer: Viewer, words: WordsOfPlaybooks): ServedActivityRowWithGoals {
  const { goal, ...shown } = row;
  return {
    ...servedRow(shown, seenKindsWithGoals.has(row.kind) ? isSeenBy(viewer, row) : null),
    ...goalFieldsOf(row.position.playbook, goal, words),
  };
}

export function rowsServedWithGoals(goals: GoalsRead) {
  return (rows: readonly ActivityRow[], viewer: Viewer) =>
    Effect.map(wordsOfRows(goals, rows), (words) => rows.map((row) => servedWithGoals(row, viewer, words)));
}
