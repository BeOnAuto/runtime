import { Effect } from 'effect';

import { isoOf, servedRow, type ActivityRow, type GoalShown } from '../operations/activity-row.ts';
import { isSeenBy, type Viewer } from '../operations/activity-viewer.ts';
import { setAsideIn, type RequestsSetAside } from '../operations/needs-you.ts';
import { seenKindsWithGoals, type ServedActivityRowWithGoals } from './goal-schemas.ts';
import type { GoalsRead } from './goal-set-aside.ts';
import { wordOf, wordsOfRows, type WordsOfPlaybooks } from './goal-words.ts';

const noGoal = { goal: null, outcome: null, word: null, title: null, says: null, result_at: null };

function goalFieldsOf(playbook: string, goal: GoalShown | undefined, words: WordsOfPlaybooks) {
  if (goal === undefined) {
    return noGoal;
  }
  const { resultAt, ...shown } = goal;
  return { ...shown, word: wordOf(words, playbook, goal), result_at: isoOf(resultAt) };
}

interface ServedWith {
  readonly viewer: Viewer;
  readonly words: WordsOfPlaybooks;
  readonly setAside: RequestsSetAside;
}

function dismissedOf({ kind, position: { playbook, key } }: ActivityRow, setAside: RequestsSetAside) {
  const shown = kind === 'needs_you' ? setAsideIn(setAside, playbook).get(key) : undefined;
  return shown === undefined ? {} : { dismissed: shown.setAside };
}

function servedWithGoals(row: ActivityRow, { viewer, words, setAside }: ServedWith): ServedActivityRowWithGoals {
  const { goal, ...shown } = row;
  return {
    ...servedRow(shown, seenKindsWithGoals.has(row.kind) ? isSeenBy(viewer, row) : null),
    ...goalFieldsOf(row.position.playbook, goal, words),
    ...dismissedOf(row, setAside),
  };
}

export function rowsServedWithGoals(goals: GoalsRead) {
  return (rows: readonly ActivityRow[], viewer: Viewer, setAside: RequestsSetAside) =>
    Effect.map(wordsOfRows(goals, rows), (words) =>
      rows.map((row) => servedWithGoals(row, { viewer, words, setAside })),
    );
}
