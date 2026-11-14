import { isCalendarRule, type Instant, type WindowRule, type WindowSpan } from '../goal-rules/goal-rule.ts';
import { holds } from '../goal-windows/calendar-windows.ts';

interface Marked {
  readonly pinned?: { readonly window?: WindowRule };
  readonly window?: WindowSpan;
  readonly marks: readonly { readonly milestone: string; readonly run: string }[];
}

export function afterMilestoneOf(rule: WindowRule | undefined): string | undefined {
  return rule === undefined || isCalendarRule(rule) ? undefined : rule.after;
}

export function opensInRun(state: Marked, run: string): boolean {
  const after = afterMilestoneOf(state.pinned?.window);
  return state.window !== undefined && state.marks.some((mark) => mark.milestone === after && mark.run === run);
}

export function countsIn(
  rule: WindowRule,
  window: WindowSpan,
  measured: { readonly as_of: Instant; readonly opening?: true },
): boolean {
  return measured.opening === true || holds(rule, window, measured.as_of);
}
