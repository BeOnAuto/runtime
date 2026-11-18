import { dismissalRows, goalOverdueRows, goalVerdictRows } from '@on.auto/activity';
import type { KeyedProjection } from '@on.auto/operations';

import { goalFactSchemas } from '../goal-facts/goal-facts.ts';
import { goalTables } from './goal-tables.ts';

export const goalBellProjections: readonly KeyedProjection[] = [goalVerdictRows, goalOverdueRows, dismissalRows];

export const goalsLedger = {
  factSchemas: goalFactSchemas,
  projections: [...goalTables, ...goalBellProjections],
};
