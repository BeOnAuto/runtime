export const startedAt = 1_790_845_200_000;

interface Scheduled {
  readonly at: number;
  readonly order: number;
  readonly key: string;
  readonly action: () => void;
}

export interface VirtualClock {
  readonly now: () => number;
  readonly schedule: (at: number, key: string, action: () => void) => void;
  readonly unschedule: (key: string) => boolean;
  readonly has: (key: string) => boolean;
  readonly pending: () => number;
  readonly advance: () => boolean;
}

export function virtualClock(start = startedAt): VirtualClock {
  const scheduled = new Map<string, Scheduled>();
  const clock = { now: start, order: 0 };
  return {
    now: () => clock.now,
    schedule: (at, key, action) => {
      clock.order += 1;
      scheduled.set(key, { at: Math.max(at, clock.now), order: clock.order, key, action });
    },
    unschedule: (key) => scheduled.delete(key),
    has: (key) => scheduled.has(key),
    pending: () => scheduled.size,
    advance: () => {
      const [next] = [...scheduled.values()].toSorted((first, second) =>
        first.at === second.at ? first.order - second.order : first.at - second.at,
      );
      if (next === undefined) {
        return false;
      }
      scheduled.delete(next.key);
      clock.now = next.at;
      next.action();
      return true;
    },
  };
}
