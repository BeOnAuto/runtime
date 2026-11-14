import type { Goal } from '@on.auto/definitions/goals';
import type { RecordedCaller } from '@on.auto/operations';

import type { NoticeChange } from '../assessments/assessment-identity.ts';
import { textOf, type AssessmentState } from '../assessments/assessment-state.ts';
import { countsIn } from '../assessments/window-counting.ts';
import type { Target } from '../goal-rules/goal-rule.ts';

export const noResultYet = 'No result yet';

export interface NoticeInput {
  readonly change: NoticeChange;
  readonly headline: string;
  readonly detail?: string;
  readonly link?: string;
  readonly owner: RecordedCaller;
  readonly goal: { readonly id: string; readonly statement: string };
  readonly per?: { readonly id: string; readonly title?: string; readonly link?: string };
  readonly window?: { readonly opens: string; readonly closes: string };
  readonly measure?: { readonly label: string; readonly value: number; readonly target: number };
  readonly says?: string;
}

export interface Noticing {
  readonly goal: Goal;
  readonly state: AssessmentState;
  readonly change: NoticeChange;
  readonly owner: RecordedCaller;
  readonly link?: string | undefined;
}

function wordOf({ success }: Goal, change: NoticeChange): string {
  if (change === 'passed') {
    return success.passed;
  }
  return change === 'failed' ? success.failed : noResultYet;
}

function targetValueOf(target: Target): number {
  return 'at_least' in target ? target.at_least : target.at_most;
}

export interface Deciding {
  readonly value: number;
  readonly says?: string;
}

function isSettledByTheFinal({ window, verdictAt }: AssessmentState, change: NoticeChange): boolean {
  return change !== 'overdue' && window !== undefined && verdictAt !== undefined && verdictAt >= window.due;
}

function countsInItsWindow({ pinned, window, measurement }: AssessmentState): boolean {
  const rule = pinned?.window;
  return measurement === undefined || rule === undefined || window === undefined || countsIn(rule, window, measurement);
}

export function decidingOf(state: AssessmentState, change: NoticeChange): Deciding | undefined {
  const { measurement, finalMeasurement } = state;
  if (change === 'failed' && state.verdictBy === 'deadline') {
    return undefined;
  }
  if (change === 'overdue' && !countsInItsWindow(state)) {
    return undefined;
  }
  if (finalMeasurement === undefined || !isSettledByTheFinal(state, change)) {
    return measurement;
  }
  const standsForIt = measurement?.run === finalMeasurement.run && measurement.as_of === finalMeasurement.as_of;
  return standsForIt ? measurement : { value: finalMeasurement.value };
}

function saysOf({ marks }: AssessmentState, deciding: Deciding | undefined): string | undefined {
  return deciding?.says ?? marks.findLast(({ says }) => says !== undefined)?.says;
}

function perOf({ pinned, title, link }: AssessmentState): Pick<NoticeInput, 'per'> {
  if (pinned?.per === undefined) {
    return {};
  }
  return {
    per: { id: pinned.per, ...(title === undefined ? {} : { title }), ...(link === undefined ? {} : { link }) },
  };
}

function windowOf({ window }: AssessmentState): Pick<NoticeInput, 'window'> {
  return window === undefined ? {} : { window: { opens: textOf(window.opens), closes: textOf(window.closes) } };
}

function measureOf(
  { success }: Goal,
  { pinned }: AssessmentState,
  deciding: Deciding | undefined,
): Pick<NoticeInput, 'measure'> {
  if (deciding === undefined) {
    return {};
  }
  const target = targetValueOf(pinned?.target ?? success.target);
  return { measure: { label: success.label, value: deciding.value, target } };
}

function detailOf(goal: Goal, deciding: Deciding | undefined, says: string | undefined): Pick<NoticeInput, 'detail'> {
  if (says !== undefined) {
    return { detail: says };
  }
  return deciding === undefined ? {} : { detail: `${goal.success.label}: ${String(deciding.value)}` };
}

export function noticeInputOf({ goal, state, change, owner, link }: Noticing): NoticeInput {
  const deciding = decidingOf(state, change);
  const says = saysOf(state, deciding);
  return {
    change,
    headline: `${wordOf(goal, change)}: ${state.title ?? goal.statement}`,
    ...detailOf(goal, deciding, says),
    ...(link === undefined ? {} : { link }),
    owner,
    goal: { id: goal.id, statement: goal.statement },
    ...perOf(state),
    ...windowOf(state),
    ...measureOf(goal, state, deciding),
    ...(says === undefined ? {} : { says }),
  };
}
