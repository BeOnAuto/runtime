import { activityProjections } from '@on.auto/activity';
import { definitionsReadModel } from '@on.auto/definitions';
import { assets, assetTotals, generationsWaiting } from '@on.auto/generation';
import { conversations, openRequests, readings, tellings } from '@on.auto/interaction';
import type { KeyedProjection, StreamProjection } from '@on.auto/operations';

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

export const keptStreamProjections: readonly StreamProjection[] = [definitionsReadModel];
