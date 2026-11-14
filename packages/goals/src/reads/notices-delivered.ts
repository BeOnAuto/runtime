import type { PlaybookReader } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { NoticeRead } from './assessment-read.ts';

export type NoticesDelivered = (
  notices: readonly NoticeRead[],
) => Effect.Effect<readonly NoticeRead[], never, PlaybookReader>;
