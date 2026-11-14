import type { EntryRule } from '../goal-rules/entry-rule.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import type { ConditionVerdicts, Contribution } from './observation.ts';
import { observationsOf } from './observations.ts';

export const endedAt = Date.parse('2026-11-09T09:00:00Z');

export const experiments: GoalRule = {
  id: 'paying-customers',
  per: 'experiment',
  window: { after: 'live', for: 'P7D', grace: 'P1D' },
  success: { settles: 'on_crossing', target: { at_least: 1 } },
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

export const controls: GoalRule = {
  id: 'controls-hold',
  window: { calendar: 'day' },
  success: { settles: 'on_crossing', target: { at_most: 0 } },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now' },
};

export function contributed(
  goal: GoalRule,
  entry: Omit<EntryRule, 'goal'>,
  output: unknown,
  when?: ConditionVerdicts,
): Contribution {
  return {
    goal,
    entry: { goal: goal.id, ...entry },
    entryIndex: 0,
    run: { record: 'record-1', run: 'run-1', workflow: 'measure', version: 3, ended_at: endedAt, output },
    ...(when === undefined ? {} : { when }),
  };
}

export const source = { record: 'record-1', run: 'run-1', workflow: 'measure', version: 3, entry: 0 };

export function detailsOf(contribution: Contribution): readonly string[] {
  return observationsOf(contribution).refused.map(({ detail }) => detail);
}
