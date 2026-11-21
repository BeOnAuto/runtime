import { Function } from 'effect';

import type { Timer } from '../bounds/timers.ts';

export interface Wait {
  readonly ms: number;
  readonly stopped: boolean;
}

export interface RecordingTimer {
  readonly timer: Timer;
  readonly waits: () => readonly Wait[];
}

export function recordingTimer(): RecordingTimer {
  const waits: Wait[] = [];
  return {
    timer: {
      after: (ms) => {
        const index = waits.push({ ms, stopped: false }) - 1;
        return () => {
          waits[index] = { ms, stopped: true };
        };
      },
    },
    waits: () => [...waits],
  };
}

export interface EndingPauses {
  readonly timer: Timer;
  readonly pauses: () => readonly number[];
}

export function pausesEndingAt(ms: number): EndingPauses {
  const pauses: number[] = [];
  return {
    timer: {
      after: (asked, expire) => {
        if (asked === ms) {
          pauses.push(asked);
          queueMicrotask(expire);
        }
        return Function.constVoid;
      },
    },
    pauses: () => [...pauses],
  };
}
