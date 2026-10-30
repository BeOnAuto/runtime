import type { SignalSource } from '../lifecycle/stop-request.ts';

export function coalescedSignals(source: SignalSource, windowMs: number, clock: () => number): SignalSource {
  return {
    on: (signal, listener) => {
      let heardAt = Number.NEGATIVE_INFINITY;
      return source.on(signal, () => {
        const now = clock();
        if (now - heardAt >= windowMs) {
          heardAt = now;
          listener();
        }
      });
    },
  };
}
