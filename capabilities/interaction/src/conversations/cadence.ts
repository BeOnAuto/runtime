import { readDuration } from '@on.auto/workflow-engine/dsl';

import type { Replies } from '../tool-blocks/tool-block-schemas.ts';

export const firstReadWaitMs = 5000;

const replyReadWaits = {
  first: firstReadWaitMs,
  doubling: [10_000, 20_000, 40_000],
  minute: { waitMs: 60_000, throughRead: 18 },
  restingMs: 300_000,
  mostRetryAfterMs: 3_600_000,
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

export interface NextWait {
  readonly read: number;
  readonly floorMs: number;
  readonly retryAfterMs: number | null;
}

export function waitBefore({ read, floorMs, retryAfterMs }: NextWait): number {
  const floored = Math.max(waitBeforeRead(read), floorMs);
  return retryAfterMs === null ? floored : Math.max(floored, Math.min(retryAfterMs, replyReadWaits.mostRetryAfterMs));
}

export function replyWaitMsOf({ wait }: Pick<Replies, 'wait'>): number {
  const reading = wait === undefined ? undefined : readDuration(wait);
  return reading !== undefined && 'milliseconds' in reading ? reading.milliseconds : firstReadWaitMs;
}
