import type { KeyedProjection } from '@on.auto/operations';

import { conversations } from '../conversations/conversation-rows.ts';
import { readings } from '../readings/reading-rows.ts';
import { openRequests } from '../requests/open-requests.ts';
import { tellings } from '../tellings/telling-rows.ts';

export const chatProjections: readonly KeyedProjection[] = [openRequests, conversations, readings, tellings];
