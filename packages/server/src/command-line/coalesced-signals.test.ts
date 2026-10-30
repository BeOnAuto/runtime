import { describe, expect, it } from 'vitest';

import type { SignalSource, StopSignal } from '../lifecycle/stop-request.ts';
import { coalescedSignals } from './coalesced-signals.ts';

interface FakeSignals extends SignalSource {
  readonly send: (signal: StopSignal) => void;
}

function fakeSignals(): FakeSignals {
  const listeners: { readonly signal: StopSignal; readonly listener: () => void }[] = [];
  return {
    on: (signal, listener) => {
      listeners.push({ signal, listener });
    },
    send: (signal) => {
      for (const registered of listeners.filter((entry) => entry.signal === signal)) {
        registered.listener();
      }
    },
  };
}

describe('signals coalesced over a window', () => {
  it('count the same signal sent again within the window once, as npm sends Ctrl+C twice', () => {
    const source = fakeSignals();
    let now = 0;
    const heard: StopSignal[] = [];
    coalescedSignals(source, 1000, () => now).on('SIGINT', () => {
      heard.push('SIGINT');
    });

    source.send('SIGINT');
    now = 20;
    source.send('SIGINT');

    expect(heard).toEqual(['SIGINT']);
  });

  it('count a signal sent again after the window', () => {
    const source = fakeSignals();
    let now = 0;
    const heard: StopSignal[] = [];
    coalescedSignals(source, 1000, () => now).on('SIGINT', () => {
      heard.push('SIGINT');
    });

    source.send('SIGINT');
    now = 1000;
    source.send('SIGINT');

    expect(heard).toEqual(['SIGINT', 'SIGINT']);
  });

  it('keep each signal apart', () => {
    const source = fakeSignals();
    const heard: StopSignal[] = [];
    const signals = coalescedSignals(source, 1000, () => 0);
    signals.on('SIGINT', () => {
      heard.push('SIGINT');
    });
    signals.on('SIGTERM', () => {
      heard.push('SIGTERM');
    });

    source.send('SIGINT');
    source.send('SIGTERM');

    expect(heard).toEqual(['SIGINT', 'SIGTERM']);
  });
});
