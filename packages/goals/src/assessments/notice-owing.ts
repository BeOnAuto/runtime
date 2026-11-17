import type { AssessmentFact } from './assessment-facts.ts';
import type { AssessmentState, OwedNotice } from './assessment-state.ts';

type FactOf<Type extends AssessmentFact['type']> = Extract<AssessmentFact, { readonly type: Type }>['data'];

export function refusedAfter(state: AssessmentState, data: FactOf<'goal_notice_refused'>): AssessmentState {
  const owed = state.owed.flatMap((owing): readonly OwedNotice[] => {
    if (owing.change !== data.change) {
      return [owing];
    }
    return data.retry_at === undefined ? [] : [{ ...owing, due: Date.parse(data.retry_at), attempt: data.attempt }];
  });
  return { ...state, owed };
}

export function startedAfter(state: AssessmentState, data: FactOf<'goal_notice_started'>): AssessmentState {
  return {
    ...state,
    owed: state.owed.filter(({ change }) => change !== data.change),
    started: state.started.some(({ change }) => change === data.change) ? state.started : [...state.started, data],
  };
}
