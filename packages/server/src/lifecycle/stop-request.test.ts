import { describe, expect, it } from 'vitest';

import { stopInsistedBy, stopRequestedBy, type SignalSource, type StopSignal } from './stop-request.ts';

function eventSignals(): { readonly signals: SignalSource; readonly send: (signal: StopSignal) => void } {
  const target = new EventTarget();
  return {
    signals: {
      on: (name, listener) => {
        target.addEventListener(name, listener);
      },
    },
    send: (signal) => {
      target.dispatchEvent(new Event(signal));
    },
  };
}

describe('stopRequestedBy', () => {
  it.each<StopSignal>(['SIGTERM', 'SIGINT'])('is requested by %s', async (signal) => {
    const signals = new EventTarget();

    const stopRequested = stopRequestedBy({
      on: (name, listener) => {
        signals.addEventListener(name, listener);
      },
    });
    signals.dispatchEvent(new Event(signal));

    await expect(stopRequested).resolves.toBeUndefined();
  });
});

describe('stopInsistedBy', () => {
  it('is insisted on by a second stop signal of either kind, not by the first', async () => {
    const { signals, send } = eventSignals();
    const insisted = stopInsistedBy(signals);
    const settled: string[] = [];
    void insisted.then(() => settled.push('insisted'));

    send('SIGTERM');
    await Promise.resolve();
    const afterOne = [...settled];
    send('SIGINT');
    await insisted;

    expect({ afterOne, afterTwo: settled }).toEqual({ afterOne: [], afterTwo: ['insisted'] });
  });
});
