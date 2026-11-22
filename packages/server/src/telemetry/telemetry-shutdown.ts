import { setTimeout } from 'node:timers/promises';

import type { SignalTelemetry } from './signal-telemetry.ts';

export const longestShutdownMs = 1000;

/** Waits the given time; the shipped one keeps no process alive that has nothing else to do. */
export type ShutdownTimer = (milliseconds: number) => Promise<unknown>;

const unreferencedTimer: ShutdownTimer = (milliseconds) => setTimeout(milliseconds, undefined, { ref: false });

/** How long a shutdown waits for the exporters to send what they hold, and the timer it waits on. */
export interface ShutdownBound {
  readonly boundMs: number;
  readonly timer: ShutdownTimer;
}

export const shippedBound: ShutdownBound = { boundMs: longestShutdownMs, timer: unreferencedTimer };

/**
 * Stops the instrumentations, then waits for every signal to send what it holds, at most the bound, since a collector
 * may take an export and never answer, and releases them all.
 */
export function shutdownOf(
  signals: readonly Pick<SignalTelemetry, 'flushed' | 'released'>[],
  stopInstrumentations: () => void,
  { boundMs, timer }: ShutdownBound,
): () => Promise<void> {
  return async () => {
    stopInstrumentations();
    await Promise.race([Promise.allSettled(signals.map(({ flushed }) => flushed())), timer(boundMs)]);
    for (const { released } of signals) {
      released();
    }
  };
}
