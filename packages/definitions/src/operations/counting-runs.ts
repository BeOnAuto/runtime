import type { Notice } from '@on.auto/operations';
import { Effect } from 'effect';

import { contributesIn } from '../contributions/contributes-details.ts';
import type { Goal } from '../goals/goals-document.ts';
import { playbookGoalsIn } from '../goals/goals-stream.ts';
import { loadRegistry } from './registry-access.ts';

export interface StartedByHand {
  readonly type: string;
  readonly name: string;
  readonly test: boolean;
  readonly calledByARun: boolean;
}

function inWords(names: readonly string[]): string {
  const [last, ...before] = names.toReversed();
  return before.length === 0 ? String(last) : `${before.toReversed().join(', ')} and ${String(last)}`;
}

export function countingNoticeOf(goals: readonly Goal[]): Notice {
  const names = goals.map(({ id, name }) => name ?? id);
  return {
    kind: 'counts_toward_goals',
    detail: `This run counts toward ${inWords(names)}. To try a workflow without counting, run it with test: true.`,
    certainty: 'exact',
  };
}

function goalsCountedBy(goals: readonly Goal[], counted: ReadonlySet<string>): readonly Goal[] {
  return goals.filter(({ id, retired }) => counted.has(id) && retired !== true);
}

export const countingNotices = Effect.fnUntraced(function* (started: StartedByHand) {
  if (started.type !== 'workflow' || started.test || started.calledByARun) {
    return [] satisfies readonly Notice[];
  }
  const workflow = (yield* loadRegistry('workflow')).get(started.name);
  const counted = new Set((contributesIn(workflow?.details) ?? []).map(({ goal }) => goal));
  const goals = goalsCountedBy((yield* playbookGoalsIn).goals, counted);
  const notices: readonly Notice[] = goals.length === 0 ? [] : [countingNoticeOf(goals)];
  return notices;
});
