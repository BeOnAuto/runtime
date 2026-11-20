import { Effect } from 'effect';

import { isoOf, servedRow, type ActivityRow } from '../operations/activity-row.ts';
import { isSeenBy, type Viewer } from '../operations/activity-viewer.ts';
import { setAsideIn, type RequestsSetAside } from '../operations/needs-you.ts';
import { goalNamesOfRows, type GoalNames } from './goal-names.ts';
import { seenKindsWithGoals, type ServedActivityRowWithGoals } from './goal-schemas.ts';
import type { GoalsRead } from './goal-set-aside.ts';
import { wordOf, wordsOfRows, type WordsOfPlaybooks } from './goal-words.ts';

const noGoal = { goal: null, outcome: null, word: null, title: null, says: null, result_at: null };

interface Named {
  readonly words: WordsOfPlaybooks;
  readonly names: GoalNames;
}

type GoalFields = Pick<ServedActivityRowWithGoals, keyof typeof noGoal>;

function goalFieldsOf({ goal, position: { playbook } }: ActivityRow, { words, names }: Named): GoalFields | undefined {
  if (goal === undefined) {
    return noGoal;
  }
  const name = names.get(goal.goalKey);
  if (name === undefined) {
    return undefined;
  }
  const { goalKey: _, resultAt, ...shown } = goal;
  return { goal: name, ...shown, word: wordOf(words, playbook, name, shown.outcome), result_at: isoOf(resultAt) };
}

interface ServedWith extends Named {
  readonly viewer: Viewer;
  readonly setAside: RequestsSetAside;
}

function dismissedOf({ kind, position: { playbook, key } }: ActivityRow, setAside: RequestsSetAside) {
  const shown = kind === 'needs_you' ? setAsideIn(setAside, playbook).get(key) : undefined;
  return shown === undefined ? {} : { dismissed: shown.setAside };
}

function servedWithGoals(row: ActivityRow, served: ServedWith): readonly ServedActivityRowWithGoals[] {
  const { goal: _, ...shown } = row;
  const fields = goalFieldsOf(row, served);
  return fields === undefined
    ? []
    : [
        {
          ...servedRow(shown, seenKindsWithGoals.has(row.kind) ? isSeenBy(served.viewer, row) : null),
          ...fields,
          ...dismissedOf(row, served.setAside),
        },
      ];
}

export function rowsServedWithGoals(goals: GoalsRead) {
  return (rows: readonly ActivityRow[], viewer: Viewer, setAside: RequestsSetAside) =>
    Effect.map(
      Effect.all([wordsOfRows(goals, rows), goalNamesOfRows(rows)]),
      ([words, names]: readonly [WordsOfPlaybooks, GoalNames]) =>
        rows.flatMap((row) => servedWithGoals(row, { viewer, words, names, setAside })),
    );
}
