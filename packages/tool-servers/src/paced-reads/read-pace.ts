export type ReadOrder = 'oldest_first' | 'newest_first';

const mostRetryAfterMs = 3_600_000;

const millisOfASecond = 1000;

export interface NextWait {
  readonly baseMs: number;
  readonly floorMs: number;
  readonly retryAfterMs: number | null;
}

export function waitBefore({ baseMs, floorMs, retryAfterMs }: NextWait): number {
  const floored = Math.max(baseMs, floorMs);
  return retryAfterMs === null ? floored : Math.max(floored, Math.min(retryAfterMs, mostRetryAfterMs));
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

export interface ReadLimit {
  readonly quota: number;
  readonly windowSeconds: number;
}

export function limitFloorMsOf(limit: ReadLimit | undefined): number {
  return limit === undefined ? 0 : Math.ceil((limit.windowSeconds * millisOfASecond) / limit.quota);
}

export function cursorOf(order: ReadOrder, cursors: readonly string[], prior: string | null): string | null {
  return (order === 'oldest_first' ? cursors.at(-1) : cursors.at(0)) ?? prior;
}
