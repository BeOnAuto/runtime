export type DevelopmentStopSignal = 'SIGHUP' | 'SIGINT' | 'SIGTERM';

export interface DevelopmentSignals {
  on(signal: DevelopmentStopSignal, listener: () => void): unknown;
}

const stopSignals: readonly DevelopmentStopSignal[] = ['SIGHUP', 'SIGINT', 'SIGTERM'];

export function stopRequestedThrough(signals: DevelopmentSignals): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  for (const signal of stopSignals) {
    signals.on(signal, resolve);
  }
  return promise;
}
