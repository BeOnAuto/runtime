export const rowWaitBounds = { firstMs: 1000, longestMs: 300_000, keptRows: 4096 } as const;

interface Wait {
  readonly until: number;
  readonly waitMs: number;
}

export interface RowWaits {
  readonly holds: (key: string, now: number) => boolean;
  readonly heldAt: (now: number) => number;
  readonly nextUntil: (now: number) => number;
  readonly failed: (key: string, now: number) => void;
  readonly performed: (key: string) => void;
}

export function rowWaits(): RowWaits {
  const waits = new Map<string, Wait>();
  return {
    holds: (key, now) => (waits.get(key)?.until ?? Number.NEGATIVE_INFINITY) > now,
    heldAt: (now) => [...waits.values()].filter(({ until }) => until > now).length,
    nextUntil: (now) =>
      Math.min(
        Number.POSITIVE_INFINITY,
        ...[...waits.values()].map(({ until }) => until).filter((until) => until > now),
      ),
    failed: (key, now) => {
      const before = waits.get(key);
      const waitMs =
        before === undefined ? rowWaitBounds.firstMs : Math.min(before.waitMs * 2, rowWaitBounds.longestMs);
      waits.delete(key);
      waits.set(key, { until: now + waitMs, waitMs });
      const [oldest = key] = waits.keys();
      if (waits.size > rowWaitBounds.keptRows) {
        waits.delete(oldest);
      }
    },
    performed: (key) => {
      waits.delete(key);
    },
  };
}
