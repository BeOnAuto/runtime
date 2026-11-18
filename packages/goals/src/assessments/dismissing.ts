import type { RecordedCaller } from '@on.auto/operations';

import type { Instant } from '../goal-rules/goal-rule.ts';
import type { AssessmentFact, GoalDismissed } from './assessment-facts.ts';
import type { AssessmentState } from './assessment-state.ts';

export const mostRequestsSetAside = 10;

export interface Dismissed {
  readonly at: Instant;
  readonly by: RecordedCaller;
  readonly requests: readonly string[];
}

type DismissalFact = Extract<AssessmentFact, { readonly type: 'goal_dismissed' | 'goal_restored' }>;

function dismissedOf({ at, by, requests }: GoalDismissed): Dismissed {
  return { at: Date.parse(at), by, requests };
}

export function dismissedAfter(state: AssessmentState, fact: DismissalFact): AssessmentState {
  if (state.pinned === undefined) {
    return state;
  }
  if (fact.type === 'goal_dismissed') {
    return { ...state, dismissed: dismissedOf(fact.data) };
  }
  const { dismissed: _, ...restored } = state;
  return restored;
}

export interface Dismissing {
  readonly dismissed: boolean;
  readonly at: Instant;
  readonly by: RecordedCaller;
  readonly requests: readonly string[];
}

export function factsDismissing(
  state: AssessmentState,
  { dismissed, at, by, requests }: Dismissing,
): readonly AssessmentFact[] {
  const { pinned } = state;
  if (pinned === undefined || dismissed === (state.dismissed !== undefined)) {
    return [];
  }
  const thing = { goal: pinned.goal, ...(pinned.per === undefined ? {} : { per: pinned.per }) };
  const when = new Date(at).toISOString();
  return dismissed
    ? [{ type: 'goal_dismissed', data: { ...thing, at: when, by, requests: requests.slice(0, mostRequestsSetAside) } }]
    : [{ type: 'goal_restored', data: { ...thing, at: when, by } }];
}

export interface AskedAgain {
  readonly asked: Instant;
  readonly at: Instant;
  readonly by: RecordedCaller;
}

export function factsRestoredByAsking(
  state: AssessmentState,
  { asked, at, by }: AskedAgain,
): readonly AssessmentFact[] {
  const { dismissed } = state;
  return dismissed === undefined || dismissed.at >= asked
    ? []
    : factsDismissing(state, { dismissed: false, at, by, requests: [] });
}
