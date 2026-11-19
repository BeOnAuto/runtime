import { readDuration } from '@on.auto/workflow-engine/dsl';

import type { ReadLimit } from '../tellings/telling-routes.ts';
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

export interface WokenRead {
  readonly now: number;
  readonly floorMs: number;
  readonly reads: number;
  readonly anchor: number;
}

export function wokenReadAt({ now, floorMs, reads, anchor }: WokenRead): number {
  const windowMs = floorMs * reads;
  const windowEnd = anchor + (Math.floor((now - anchor) / windowMs) + 1) * windowMs;
  return Math.max(now + floorMs, windowEnd);
}

export function replyWaitMsOf({ wait }: Pick<Replies, 'wait'>): number {
  const reading = wait === undefined ? undefined : readDuration(wait);
  return reading !== undefined && 'milliseconds' in reading ? reading.milliseconds : firstReadWaitMs;
}

export function readFloorMsOf(replies: Pick<Replies, 'wait'>, limit: ReadLimit | undefined): number {
  const apartMs = limit === undefined ? 0 : Math.ceil((limit.windowSeconds * 1000) / limit.quota);
  return Math.max(replyWaitMsOf(replies), apartMs);
}
