import type { ProjectedCondition, ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { instantIn } from '../reads/assessment-read.ts';
import type { GoalRows } from './goal-rows.ts';

type JudgedOutcome = 'passed' | 'failed' | 'no_result';

export const judgedOutcomes: readonly JudgedOutcome[] = ['passed', 'failed', 'no_result'];

export const missedOutcomes: readonly JudgedOutcome[] = ['failed', 'no_result'];

export interface Between {
  readonly after?: number;
  readonly before?: number;
}

export interface JudgedEnd {
  readonly at: number;
  readonly row: ProjectedKeyedRow;
}

function boundsOf({ after, before }: Between): readonly ProjectedCondition[] {
  return [
    ...(after === undefined ? [] : [{ column: 'closed_at', after }]),
    ...(before === undefined ? [] : [{ column: 'closed_at', before }]),
  ];
}

function whereOf(outcome: JudgedOutcome, between: Between): readonly ProjectedCondition[] {
  return [{ column: 'outcome', equals: outcome }, ...boundsOf(between)];
}

const direction = { asc: 1, desc: -1 } as const;

function inOrder(order: 'asc' | 'desc') {
  return (left: JudgedEnd, right: JudgedEnd): number => direction[order] * (left.at - right.at);
}

export function judgedEndOf(
  rows: GoalRows,
  outcomes: readonly JudgedOutcome[],
  between: Between,
  order: 'asc' | 'desc',
): Effect.Effect<JudgedEnd | undefined> {
  return Effect.map(
    Effect.forEach(outcomes, (outcome) => rows.read(whereOf(outcome, between), ['closed_at'], order, 1)),
    (found: readonly (readonly ProjectedKeyedRow[])[]) =>
      found
        .flat()
        .map((row) => ({ at: instantIn(row, 'closed_at', 0), row }))
        .toSorted(inOrder(order))
        .at(0),
  );
}

export function judgedCountOf(
  rows: GoalRows,
  outcomes: readonly JudgedOutcome[],
  between: Between,
): Effect.Effect<number> {
  return Effect.map(
    Effect.forEach(outcomes, (outcome) => rows.count(whereOf(outcome, between))),
    (counts: readonly number[]) => counts.reduce((total, count) => total + count, 0),
  );
}
