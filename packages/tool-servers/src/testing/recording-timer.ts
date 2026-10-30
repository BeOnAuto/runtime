import type { Timer } from '../clients/http-client.ts';

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
