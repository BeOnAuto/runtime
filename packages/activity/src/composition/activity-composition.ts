import type { KeyedProjection } from '@on.auto/operations';

import { activityOperationsKeepingGoals } from '../goal-activity/goal-operations.ts';
import type { GoalsRead } from '../goal-activity/goal-set-aside.ts';
import { listActivity } from '../operations/list-activity.ts';
import { markActivitySeen } from '../operations/mark-activity-seen.ts';
import { activityRows } from '../projections/activity-rows.ts';
import { brokenRows } from '../projections/broken-rows.ts';
import { commentRows } from '../projections/comment-rows.ts';
import { requestRows } from '../projections/request-rows.ts';
import { seenRows } from '../projections/seen-rows.ts';

export const activityProjections: readonly KeyedProjection[] = [
  activityRows,
  requestRows,
  brokenRows,
  seenRows,
  commentRows,
];

export function activityOperationsOf(goals?: GoalsRead) {
  const served = goals === undefined ? { listActivity, markActivitySeen } : activityOperationsKeepingGoals(goals);
  return [served.listActivity, served.markActivitySeen];
}
