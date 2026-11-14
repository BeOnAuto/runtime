import type { Instant } from '../goal-rules/goal-rule.ts';
import { missedAtOf } from '../goal-windows/calendar-windows.ts';
import { isMarked, isOpen, type AssessmentState } from './assessment-state.ts';

export function judgingDueOf(state: AssessmentState): Instant | undefined {
  const { window } = state;
  if (!isOpen(state) || state.verdict !== 'open' || window === undefined) {
    return undefined;
  }
  return state.overdueSince === undefined ? window.due : missedAtOf(state.pinned?.window, window);
}

export function noticeDueOf(state: AssessmentState): Instant | undefined {
  const dues = state.owed.map(({ due }) => due);
  return dues.length === 0 ? undefined : Math.min(...dues);
}

export function nextMilestoneOf(state: AssessmentState): string | undefined {
  return state.pinned?.milestones.find(({ id }) => !isMarked(state, id))?.id;
}
