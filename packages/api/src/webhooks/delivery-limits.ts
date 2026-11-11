const minuteMs = 60_000;

const mostKeysKept = 10_000;

interface Window {
  readonly startsAt: number;
  readonly count: number;
}

export interface Limiter {
  readonly secondsToWait: (key: string, nowMs: number) => number;
}

function windowAt(nowMs: number): number {
  return Math.floor(nowMs / minuteMs) * minuteMs;
}

export function limiterOf(mostInAMinute: number): Limiter {
  const windows = new Map<string, Window>();
  const kept = (key: string, window: Window) => {
    windows.delete(key);
    windows.set(key, window);
    const [oldest] = windows.keys();
    if (windows.size > mostKeysKept && oldest !== undefined) {
      windows.delete(oldest);
    }
  };
  return {
    secondsToWait: (key, nowMs) => {
      const startsAt = windowAt(nowMs);
      const window = windows.get(key);
      const count = window?.startsAt === startsAt ? window.count : 0;
      if (count >= mostInAMinute) {
        return Math.ceil((startsAt + minuteMs - nowMs) / 1000);
      }
      kept(key, { startsAt, count: count + 1 });
      return 0;
    },
  };
}
