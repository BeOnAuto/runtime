import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '@on.auto/operations';

import { assessmentsKind, goalSummariesKind } from '../goal-facts/goal-facts.ts';

export const noticeDaysName = 'goal_notice_days';

const startTypes: ReadonlySet<string> = new Set(['goal_notice_started', 'goal_summary_started']);

export function noticeDayOf(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

function keyOf({ type, context }: ProjectedMessage): string | undefined {
  const at = Date.parse(context.at);
  return startTypes.has(type) && Number.isFinite(at) ? noticeDayOf(at) : undefined;
}

function startedIn(row: ProjectedRow | undefined): number {
  const started = row?.['started'];
  return typeof started === 'number' ? started : 0;
}

export const noticeDays: KeyedProjection = {
  name: noticeDaysName,
  version: 1,
  kinds: [assessmentsKind, goalSummariesKind],
  types: [...startTypes],
  columns: [{ name: 'started', kind: 'integer' }],
  indexes: [],
  keyOf,
  rowAfter: (row) => ({ started: startedIn(row) + 1 }),
};
