export type StopSignal = 'SIGINT' | 'SIGTERM';

export interface SignalSource {
  on(signal: StopSignal, listener: () => void): unknown;
}

const stopSignals: readonly StopSignal[] = ['SIGTERM', 'SIGINT'];

export function stopRequestedBy(signals: SignalSource): Promise<void> {
  return stopSignalNumber(signals, 1);
}

export function stopInsistedBy(signals: SignalSource): Promise<void> {
  return stopSignalNumber(signals, 2);
}

function stopSignalNumber(signals: SignalSource, wanted: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const received: StopSignal[] = [];
  for (const signal of stopSignals) {
    signals.on(signal, () => {
      received.push(signal);
      if (received.length >= wanted) {
        resolve();
      }
    });
  }
  return promise;
}
