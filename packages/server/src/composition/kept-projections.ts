import { activityProjections } from '@on.auto/activity';
import { assets, assetTotals, generationsWaiting } from '@on.auto/generation';
import { conversations, openRequests } from '@on.auto/interaction';
import { memoryRows } from '@on.auto/memory';
import type { KeyedProjection } from '@on.auto/operations';

export const keptProjections: readonly KeyedProjection[] = [
  openRequests,
  conversations,
  ...activityProjections,
  memoryRows,
  assets,
  assetTotals,
  generationsWaiting,
];
