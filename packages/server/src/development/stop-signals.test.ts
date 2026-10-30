import { expect, it } from 'vitest';

import { stopRequestedThrough, type DevelopmentStopSignal } from './stop-signals.ts';

it.each<DevelopmentStopSignal>(['SIGHUP', 'SIGINT', 'SIGTERM'])(
  'asks the dev runner to stop on %s and takes any later signal as the same request',
  async (signal) => {
    const listeners: (readonly [DevelopmentStopSignal, () => void])[] = [];
    const stopRequested = stopRequestedThrough({
      on: (name, listener) => listeners.push([name, listener]),
    });

    for (const [, listener] of listeners.filter(([emitted]) => [signal, 'SIGTERM'].includes(emitted))) {
      listener();
    }

    await expect(stopRequested).resolves.toBeUndefined();
  },
);
