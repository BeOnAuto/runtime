import {
  recordedDecoder,
  type KeyedProjection,
  type ProjectedColumn,
  type ProjectedMessage,
  type ProjectedRow,
} from '@on.auto/operations';
import { Option } from 'effect';

import { judgingDueOf, nextMilestoneOf, noticeDueOf } from '../assessments/assessment-dues.ts';
import {
  assessmentAfter,
  isMarked,
  isOpen,
  isUndecided,
  unopened,
  type AssessmentState,
  type PinnedRule,
} from '../assessments/assessment-state.ts';
import { AssessmentEventSchema, assessmentsKind, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';
import { missedAtOf } from '../goal-windows/calendar-windows.ts';
import { assessmentStateOfText, assessmentStateText } from './assessment-row-state.ts';
import { noticeColumnsAfter } from './notice-columns.ts';

export const assessmentsName = 'goal_assessments';

export const mostMarkColumns = 7;

const assessmentEventOf = recordedDecoder(AssessmentEventSchema);

export const markColumns: readonly string[] = Array.from(
  { length: mostMarkColumns },
  (_, index) => `mark_${String(index + 1)}`,
);

function textColumn(name: string): ProjectedColumn {
  return { name, kind: 'text' };
}

function instantOf(text: string): number {
  return Date.parse(text);
}

function carried(row: ProjectedRow | undefined, column: string): string | number | boolean | null {
  return row?.[column] ?? null;
}

function marksOf(state: AssessmentState, { milestones }: PinnedRule): ProjectedRow {
  return Object.fromEntries(
    markColumns.map((column, index) => {
      const id = milestones[index]?.id;
      return [column, id !== undefined && isMarked(state, id) ? id : null];
    }),
  );
}

function outcomeOf(state: AssessmentState): string | null {
  if (state.verdict !== 'open') {
    return state.verdict;
  }
  return state.ended ?? null;
}

function noResultAtOf(state: AssessmentState): number | null {
  return isUndecided(state) && state.window !== undefined ? missedAtOf(state.pinned?.window, state.window) : null;
}

function nullWhenAbsent<Value extends string | number>(value: Value | undefined): Value | null {
  return value ?? null;
}

function windowColumnsOf({ window }: AssessmentState): ProjectedRow {
  return window === undefined
    ? { window_opens: null, window_closes: null, window_due: null }
    : { window_opens: window.opens, window_closes: window.closes, window_due: window.due };
}

function thingColumnsOf(state: AssessmentState, pinned: PinnedRule): ProjectedRow {
  return {
    goal: pinned.goal,
    goals_version: pinned.goalsVersion,
    per_id: nullWhenAbsent(pinned.per),
    ...windowColumnsOf(state),
    title: nullWhenAbsent(state.title),
    link: nullWhenAbsent(state.link),
    next_milestone: nullWhenAbsent(nextMilestoneOf(state)),
    ...marksOf(state, pinned),
  };
}

function stoppedColumnsOf(state: AssessmentState): ProjectedRow {
  const { stopped } = state;
  return stopped === undefined || !isUndecided(state)
    ? { stopped_at: null, stopped_run: null }
    : { stopped_at: stopped.at, stopped_run: stopped.run };
}

function dismissedColumnsOf({ dismissed }: AssessmentState): ProjectedRow {
  return dismissed === undefined
    ? { dismissed: false, dismissed_at: null, dismissed_by: null }
    : { dismissed: true, dismissed_at: dismissed.at, dismissed_by: dismissed.by.id };
}

function columnsOf(state: AssessmentState, pinned: PinnedRule): ProjectedRow {
  return {
    ...thingColumnsOf(state, pinned),
    verdict: state.verdict,
    verdict_at: nullWhenAbsent(state.verdictAt),
    overdue: state.overdueSince !== undefined,
    overdue_since: nullWhenAbsent(state.overdueSince),
    outcome: outcomeOf(state),
    open: isUndecided(state),
    judging_due_at: nullWhenAbsent(judgingDueOf(state)),
    no_result_at: noResultAtOf(state),
    notice_due_at: nullWhenAbsent(noticeDueOf(state)),
    ...stoppedColumnsOf(state),
    ...dismissedColumnsOf(state),
    state: assessmentStateText(state),
  };
}

interface Moments {
  readonly opened_at: number | string | boolean | null;
  readonly observed_at: number | string | boolean | null;
  readonly closed_at: number | string | boolean | null;
  readonly closed_recorded_at: number | string | boolean | null;
  readonly overdue_recorded_at: number | string | boolean | null;
  readonly verdict_told: number | string | boolean | null;
  readonly overdue_told: number | string | boolean | null;
}

interface Change {
  readonly before: AssessmentState;
  readonly after: AssessmentState;
}

function closedAtOf(row: ProjectedRow | undefined, { before, after }: Change, at: number) {
  const ended = before.ended === undefined && after.ended !== undefined;
  return after.verdictAt ?? (ended ? at : carried(row, 'closed_at'));
}

function recordedAtOf(row: ProjectedRow | undefined, { before, after }: Change, at: number) {
  const closed = isUndecided(before) && !isUndecided(after);
  const fellOverdue = before.overdueSince === undefined && after.overdueSince !== undefined;
  return {
    closed_recorded_at: closed ? at : carried(row, 'closed_recorded_at'),
    overdue_recorded_at: fellOverdue ? at : carried(row, 'overdue_recorded_at'),
  };
}

function toldOf(row: ProjectedRow | undefined, { before, after }: Change, event: RecordedAssessmentEvent) {
  const decided = before.verdict === 'open' && after.verdict !== 'open';
  const fellOverdue = before.overdueSince === undefined && after.overdueSince !== undefined;
  return {
    verdict_told: event.type === 'goal_assessed' && decided ? event.data.told : carried(row, 'verdict_told'),
    overdue_told: event.type === 'goal_overdue' && fellOverdue ? event.data.told : carried(row, 'overdue_told'),
  };
}

function momentsAfter(row: ProjectedRow | undefined, change: Change, event: RecordedAssessmentEvent): Moments {
  const at = instantOf(event.context.at);
  return {
    opened_at: change.before.pinned === undefined ? at : carried(row, 'opened_at'),
    observed_at:
      event.type === 'goal_observed' && isOpen(change.before) ? instantOf(event.data.at) : carried(row, 'observed_at'),
    closed_at: closedAtOf(row, change, at),
    ...recordedAtOf(row, change, at),
    ...toldOf(row, change, event),
  };
}

function stateIn(row: ProjectedRow | undefined): AssessmentState {
  return assessmentStateOfText(row?.['state']) ?? unopened;
}

function rowAfterEvent(row: ProjectedRow | undefined, event: RecordedAssessmentEvent): ProjectedRow | undefined {
  const before = stateIn(row);
  const after = assessmentAfter(before, event);
  if (after.pinned === undefined) {
    return undefined;
  }
  return {
    ...columnsOf(after, after.pinned),
    ...momentsAfter(row, { before, after }, event),
    ...noticeColumnsAfter(row, before, event),
  };
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  return Option.getOrUndefined(
    Option.flatMap(assessmentEventOf(message), (event) => Option.fromUndefinedOr(rowAfterEvent(row, event))),
  );
}

const goalIndex = (name: string, columns: readonly string[]) => ({ name, columns: ['goal', ...columns, 'row_key'] });

export const assessmentRows: KeyedProjection = {
  name: assessmentsName,
  version: 6,
  kinds: [assessmentsKind],
  types: [
    'goal_assessment_opened',
    'goal_observed',
    'goal_assessed',
    'goal_overdue',
    'goal_notice_started',
    'goal_notice_refused',
    'goal_assessment_ended',
    'goal_stopped',
    'goal_dismissed',
    'goal_restored',
  ],
  columns: [
    { name: 'goal', kind: 'text' },
    { name: 'goals_version', kind: 'integer' },
    { name: 'per_id', kind: 'text' },
    { name: 'window_opens', kind: 'integer' },
    { name: 'window_closes', kind: 'integer' },
    { name: 'window_due', kind: 'integer' },
    { name: 'title', kind: 'text' },
    { name: 'link', kind: 'text' },
    { name: 'next_milestone', kind: 'text' },
    ...markColumns.map((name) => textColumn(name)),
    { name: 'verdict', kind: 'text' },
    { name: 'verdict_at', kind: 'integer' },
    { name: 'verdict_told', kind: 'text' },
    { name: 'overdue', kind: 'boolean' },
    { name: 'overdue_since', kind: 'integer' },
    { name: 'overdue_told', kind: 'text' },
    { name: 'outcome', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'opened_at', kind: 'integer' },
    { name: 'observed_at', kind: 'integer' },
    { name: 'closed_at', kind: 'integer' },
    { name: 'closed_recorded_at', kind: 'integer' },
    { name: 'overdue_recorded_at', kind: 'integer' },
    { name: 'judging_due_at', kind: 'integer' },
    { name: 'no_result_at', kind: 'integer' },
    { name: 'notice_due_at', kind: 'integer' },
    { name: 'notices', kind: 'text' },
    { name: 'noticed_at', kind: 'integer' },
    { name: 'notice_refusals', kind: 'text' },
    { name: 'notice_refused_at', kind: 'integer' },
    { name: 'stopped_at', kind: 'integer' },
    { name: 'stopped_run', kind: 'text' },
    { name: 'dismissed', kind: 'boolean' },
    { name: 'dismissed_at', kind: 'integer' },
    { name: 'dismissed_by', kind: 'text' },
    { name: 'state', kind: 'text' },
  ],
  indexes: [
    goalIndex('in_flight', ['open', 'dismissed', 'overdue', 'window_due']),
    goalIndex('newest', ['open', 'dismissed', 'opened_at']),
    goalIndex('waiting', ['open', 'dismissed', 'next_milestone']),
    goalIndex('closed', ['open', 'closed_at']),
    goalIndex('closed_recorded', ['open', 'closed_recorded_at']),
    goalIndex('overdue_recorded', ['open', 'overdue', 'overdue_recorded_at']),
    goalIndex('outcomes', ['outcome', 'closed_at']),
    goalIndex('stopped', ['open', 'dismissed', 'stopped_at']),
    { name: 'dismissed', columns: ['dismissed', 'dismissed_at', 'row_key'] },
    goalIndex('noticed', ['noticed_at']),
    goalIndex('refused_notices', ['notice_refused_at']),
    { name: 'judging_due', columns: ['judging_due_at'], acrossPlaybooks: true, whereSet: 'judging_due_at' },
    { name: 'notice_due', columns: ['notice_due_at'], acrossPlaybooks: true, whereSet: 'notice_due_at' },
  ],
  advanced: [
    {
      column: 'judging_due_at',
      setBy: ['goal_assessment_opened', 'goal_observed', 'goal_assessed', 'goal_overdue', 'goal_assessment_ended'],
    },
    {
      column: 'notice_due_at',
      setBy: ['goal_assessed', 'goal_overdue', 'goal_notice_started', 'goal_notice_refused'],
    },
  ],
  rowAfter,
};
