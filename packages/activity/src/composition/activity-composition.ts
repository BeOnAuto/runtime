import type { KeyedProjection } from '@on.auto/operations';

import { listActivity } from '../operations/list-activity.ts';
import { markActivitySeen } from '../operations/mark-activity-seen.ts';
import { activityRows } from '../projections/activity-rows.ts';
import { brokenRows } from '../projections/broken-rows.ts';
import { requestRows } from '../projections/request-rows.ts';
import { seenRows } from '../projections/seen-rows.ts';

export const activityProjections: readonly KeyedProjection[] = [activityRows, requestRows, brokenRows, seenRows];

export const activityOperations = [listActivity, markActivitySeen];
