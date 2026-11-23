import { limitFloorMsOf } from '@on.auto/tool-servers';
import { readDuration } from '@on.auto/workflow-engine/dsl';

import type { ReadLimit } from '../tellings/telling-routes.ts';
import type { Replies } from '../tool-blocks/tool-block-schemas.ts';

export const firstReadWaitMs = 5000;

const replyReadWaits = {
  first: firstReadWaitMs,
  doubling: [10_000, 20_000, 40_000],
  minute: { waitMs: 60_000, throughRead: 18 },
  restingMs: 300_000,
} as const;

export function waitBeforeRead(read: number): number {
  if (read <= 1) {
    return replyReadWaits.first;
  }
  const doubled = replyReadWaits.doubling[read - 2];
  if (doubled !== undefined) {
    return doubled;
  }
  return read <= replyReadWaits.minute.throughRead ? replyReadWaits.minute.waitMs : replyReadWaits.restingMs;
}

export function replyWaitMsOf({ wait }: Pick<Replies, 'wait'>): number {
  const reading = wait === undefined ? undefined : readDuration(wait);
  return reading !== undefined && 'milliseconds' in reading ? reading.milliseconds : firstReadWaitMs;
}

export function readFloorMsOf(replies: Pick<Replies, 'wait'>, limit: ReadLimit | undefined): number {
  return Math.max(replyWaitMsOf(replies), limitFloorMsOf(limit));
}
