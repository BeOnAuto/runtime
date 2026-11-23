import { roleAssignmentRows } from '@on.auto/access-control';
import { activityProjections, playbookChangeRows } from '@on.auto/activity';
import { connectionRows, eventSubscriptions } from '@on.auto/connections';
import { definitionsReadModel } from '@on.auto/definitions';
import { assets, assetTotals, generationsWaiting } from '@on.auto/generation';
import { goalsLedger } from '@on.auto/goals';
import { conversations, openRequests, readings, tellings } from '@on.auto/interaction';
import type { KeptProjection } from '@on.auto/operations';
import { playbookRows } from '@on.auto/playbooks';

export const keptProjections: readonly KeptProjection[] = [
  openRequests,
  conversations,
  readings,
  tellings,
  ...activityProjections,
  assets,
  assetTotals,
  generationsWaiting,
  ...goalsLedger.projections,
  roleAssignmentRows,
  ...definitionsReadModel,
  eventSubscriptions,
  playbookRows,
  playbookChangeRows,
  connectionRows,
];
