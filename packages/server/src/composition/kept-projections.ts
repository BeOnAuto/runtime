import { activityProjections } from '@on.auto/activity';
import { assets, assetTotals, generationsWaiting } from '@on.auto/generation';
import { conversations, openRequests, readings, tellings } from '@on.auto/interaction';
import type { KeyedProjection } from '@on.auto/operations';

export const keptProjections: readonly KeyedProjection[] = [
  openRequests,
  conversations,
  readings,
  tellings,
  ...activityProjections,
  assets,
  assetTotals,
  generationsWaiting,
];
