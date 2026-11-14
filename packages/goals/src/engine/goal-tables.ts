import type { KeyedProjection } from '@on.auto/operations';

import { assessmentRows } from '../goal-tables/assessment-rows.ts';
import { clockRows } from '../goal-tables/clock-rows.ts';
import { noticeDays } from '../goal-tables/notice-days.ts';
import { observationRows } from '../goal-tables/observation-rows.ts';
import { refusalRows } from '../goal-tables/refusal-rows.ts';
import { summaryRows } from '../goal-tables/summary-rows.ts';

export const goalTables: readonly KeyedProjection[] = [
  assessmentRows,
  clockRows,
  refusalRows,
  noticeDays,
  summaryRows,
  observationRows,
];
