import { dismissalRows, goalOverdueRows, goalVerdictRows } from '@on.auto/activity';
import type { LayoutStep } from '@on.auto/ledger';
import type { KeyedProjection } from '@on.auto/operations';

import { goalFactSchemas } from '../goal-facts/goal-facts.ts';
import { goalTables } from './goal-tables.ts';

const goalsLayout = 24;

export const goalBellProjections: readonly KeyedProjection[] = [goalVerdictRows, goalOverdueRows, dismissalRows];

const goalLayoutSteps: readonly LayoutStep[] = [{ layout: goalsLayout, statements: [] }];

export const goalsLedger = {
  factSchemas: goalFactSchemas,
  projections: [...goalTables, ...goalBellProjections],
  layoutSteps: goalLayoutSteps,
};
