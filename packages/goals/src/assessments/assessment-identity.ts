import { uuidV5 } from '@on.auto/operations';

import { isCalendarRule, type GoalRule, type Instant } from '../goal-rules/goal-rule.ts';
import { calendarSpanHolding } from '../goal-windows/calendar-windows.ts';
import type { Observation } from '../observations/observation.ts';

export const assessmentNamespace = '3f0c8a52-6d1e-5b7a-9c24-8e5f1d6b0a73';

export type AssessmentIdentity =
  | { readonly definition: string }
  | { readonly definition: string; readonly per: string }
  | { readonly definition: string; readonly window_start: Instant };

export type NoticeChange = 'passed' | 'failed' | 'overdue';

export function assessmentNameOf(identity: AssessmentIdentity): string {
  if ('per' in identity) {
    return `goals/${identity.definition}/per/${identity.per}`;
  }
  return 'window_start' in identity
    ? `goals/${identity.definition}/window/${new Date(identity.window_start).toISOString()}`
    : `goals/${identity.definition}`;
}

export function assessmentIdOf(identity: AssessmentIdentity): string {
  return uuidV5(assessmentNamespace, assessmentNameOf(identity));
}

export function noticeRunIdOf(assessmentId: string, change: NoticeChange): string {
  return uuidV5(assessmentId, change);
}

export function identityOfObservation(
  definition: string,
  goal: GoalRule,
  observation: Observation,
): AssessmentIdentity {
  if (goal.window !== undefined && isCalendarRule(goal.window)) {
    const asOf = observation.measurement?.as_of ?? observation.at;
    return { definition, window_start: calendarSpanHolding(goal.window, asOf).opens };
  }
  return observation.per === undefined ? { definition } : { definition, per: observation.per };
}

export function summaryRunIdOf(definition: string, due: Instant): string {
  return uuidV5(assessmentNamespace, `goals/${definition}/summary/${new Date(due).toISOString()}`);
}
