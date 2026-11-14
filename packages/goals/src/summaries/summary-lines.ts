import type { PlaybookAddress, ProjectedCondition, ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { unopened } from '../assessments/assessment-state.ts';
import { assessmentStateOfText } from '../goal-tables/assessment-row-state.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import type { GoalLinkOf } from '../notice-links/goal-links.ts';
import type { NoticeLedger } from '../notices/notice-ledger.ts';
import {
  mostSummaryLines,
  type SummarisedAs,
  type SummarisedAssessment,
  type SummaryCounts,
  type SummaryWindow,
} from './summary-input.ts';

export interface Summarised {
  readonly assessments: readonly SummarisedAssessment[];
  readonly counts: SummaryCounts;
}

export interface SummaryReading {
  readonly ledger: NoticeLedger;
  readonly address: PlaybookAddress;
  readonly goal: string;
  readonly window: SummaryWindow;
  readonly linkOf?: GoalLinkOf | undefined;
}

function within(column: string, { from, to }: SummaryWindow): readonly ProjectedCondition[] {
  return [
    { column, after: from - 1 },
    { column, before: to },
  ];
}

function closedIn(goal: string, window: SummaryWindow): readonly ProjectedCondition[] {
  return [{ column: 'goal', equals: goal }, { column: 'open', equals: false }, ...within('closed_recorded_at', window)];
}

function overdueIn(goal: string, window: SummaryWindow): readonly ProjectedCondition[] {
  return [
    { column: 'goal', equals: goal },
    { column: 'open', equals: true },
    { column: 'overdue', equals: true },
    ...within('overdue_recorded_at', window),
  ];
}

function numberIn(row: ProjectedKeyedRow['row'], column: string): number {
  const value = row[column];
  return typeof value === 'number' ? value : 0;
}

function closedAs(outcome: unknown): SummarisedAs {
  return outcome === 'passed' || outcome === 'failed' ? outcome : 'no_result';
}

interface Placed {
  readonly summarised: SummarisedAssessment;
  readonly starts: number;
}

function placedOf(reading: SummaryReading, { key, row }: ProjectedKeyedRow, as: SummarisedAs, at: string): Placed {
  const state = assessmentStateOfText(row['state']) ?? unopened;
  const per = state.pinned?.per;
  const link =
    per === undefined ? undefined : reading.linkOf?.({ playbook: reading.address.playbook, goal: reading.goal, per });
  return {
    summarised: { key, state, as, at: numberIn(row, at), ...(link === undefined ? {} : { link }) },
    starts: state.window?.opens ?? numberIn(row, 'opened_at'),
  };
}

function rowsWhere(reading: SummaryReading, where: readonly ProjectedCondition[], orderedBy: string) {
  return reading.ledger.readProjectedRows(assessmentsName, reading.address, {
    where,
    orderBy: [orderedBy],
    order: 'asc',
    limit: mostSummaryLines,
  });
}

function countWhere(reading: SummaryReading, where: readonly ProjectedCondition[]) {
  return reading.ledger.countProjectedRows(assessmentsName, reading.address, where);
}

function countsIn(reading: SummaryReading): Effect.Effect<SummaryCounts> {
  const closed = closedIn(reading.goal, reading.window);
  return Effect.map(
    Effect.all([
      countWhere(reading, closed),
      countWhere(reading, [...closed, { column: 'outcome', equals: 'passed' }]),
      countWhere(reading, [...closed, { column: 'outcome', equals: 'failed' }]),
      countWhere(reading, overdueIn(reading.goal, reading.window)),
    ]),
    ([ended, passed, failed, overdue]: readonly [number, number, number, number]) => ({
      passed,
      failed,
      overdue,
      no_result: ended - passed - failed,
    }),
  );
}

function byKey(left: Placed, right: Placed): number {
  return left.summarised.key.localeCompare(right.summarised.key);
}

function byChange(left: Placed, right: Placed): number {
  return left.summarised.at === right.summarised.at ? byKey(left, right) : left.summarised.at - right.summarised.at;
}

function byStart(left: Placed, right: Placed): number {
  return left.starts === right.starts ? byKey(left, right) : left.starts - right.starts;
}

export function summarisedIn(reading: SummaryReading): Effect.Effect<Summarised> {
  return Effect.map(
    Effect.all([
      rowsWhere(reading, closedIn(reading.goal, reading.window), 'closed_recorded_at'),
      rowsWhere(reading, overdueIn(reading.goal, reading.window), 'overdue_recorded_at'),
      countsIn(reading),
    ]),
    ([closed, overdue, counts]: readonly [
      readonly ProjectedKeyedRow[],
      readonly ProjectedKeyedRow[],
      SummaryCounts,
    ]) => {
      const placed = [
        ...closed.map((found) => placedOf(reading, found, closedAs(found.row['outcome']), 'closed_at')),
        ...overdue.map((found) => placedOf(reading, found, 'overdue', 'overdue_since')),
      ];
      const shown = placed.toSorted(byChange).slice(0, mostSummaryLines).toSorted(byStart);
      return { assessments: shown.map(({ summarised }) => summarised), counts };
    },
  );
}
