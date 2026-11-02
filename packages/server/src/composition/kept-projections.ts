import { activityProjections } from '@on.auto/activity';
import { conversations, openRequests } from '@on.auto/interaction';
import type { KeyedProjection } from '@on.auto/operations';

export const keptProjections: readonly KeyedProjection[] = [openRequests, conversations, ...activityProjections];
