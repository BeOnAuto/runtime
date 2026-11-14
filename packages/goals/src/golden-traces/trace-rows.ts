import type { ProjectedRow } from '@on.auto/operations';

import { judgingDueOf, nextMilestoneOf, noticeDueOf } from '../assessments/assessment-dues.ts';
import type { AssessmentFact } from '../assessments/assessment-facts.ts';
import { isUndecided, type AssessmentState } from '../assessments/assessment-state.ts';
import { assessmentStateText } from '../goal-tables/assessment-row-state.ts';
import { assessmentRows } from '../goal-tables/assessment-rows.ts';
import { rowFoldedOf } from '../goal-tables/folded-rows.ts';
import type { TraceBook } from './trace-book.ts';

const ofThePlaybook = { at: '2026-11-01T00:00:00.000Z', by: 'playbook:alpha' };

function foldedRowOf(facts: readonly AssessmentFact[]): ProjectedRow | undefined {
  return rowFoldedOf(
    assessmentRows,
    facts.map(({ type, data }, position) => ({
      id: `fact-${String(position)}`,
      position,
      type,
      data,
      context: ofThePlaybook,
    })),
  );
}

function coreColumnsOf(state: AssessmentState): ProjectedRow {
  return {
    state: assessmentStateText(state),
    verdict: state.verdict,
    open: isUndecided(state),
    next_milestone: nextMilestoneOf(state) ?? null,
    judging_due_at: judgingDueOf(state) ?? null,
    notice_due_at: noticeDueOf(state) ?? null,
  };
}

function rowColumnsOf(row: ProjectedRow | undefined): ProjectedRow {
  return Object.fromEntries(
    ['state', 'verdict', 'open', 'next_milestone', 'judging_due_at', 'notice_due_at'].map((column) => [
      column,
      row?.[column] ?? null,
    ]),
  );
}

export function rowsAndCoreOf(book: TraceBook): readonly (readonly [ProjectedRow, ProjectedRow])[] {
  return book
    .assessments()
    .map((assessment) => [rowColumnsOf(foldedRowOf(book.facts(assessment))), coreColumnsOf(book.state(assessment))]);
}
