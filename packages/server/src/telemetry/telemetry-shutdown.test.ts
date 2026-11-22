import { trace } from '@opentelemetry/api';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { startTelemetry } from './start-telemetry.ts';
import { longestShutdownMs, shutdownOf, type ShutdownTimer } from './telemetry-shutdown.ts';

interface HeldTimer {
  readonly timer: ShutdownTimer;
  /** The time the shutdown asked to wait, once it asked. */
  readonly asked: Promise<number>;
  /** Lets the time asked for pass. */
  readonly passes: () => void;
}

/** A timer whose time passes only when the test says, telling the test the time it was asked to wait. */
function heldTimer(): HeldTimer {
  const asked = Promise.withResolvers<number>();
  const passed = Promise.withResolvers<void>();
  return {
    timer: (milliseconds) => {
      asked.resolve(milliseconds);
      return passed.promise;
    },
    asked: asked.promise,
    passes: () => {
      passed.resolve();
    },
  };
}

interface Signal {
  readonly flushed: () => Promise<void>;
  readonly released: () => void;
  readonly releases: () => number;
}

function signalFlushing(flushed: () => Promise<void>): Signal {
  const released = { count: 0 };
  return {
    flushed,
    released: () => {
      released.count += 1;
    },
    releases: () => released.count,
  };
}

const neverAnswered = (): Promise<void> => new Promise<void>(() => {});

describe('a telemetry shutdown, on a timer its test holds', () => {
  it.each([50, 1000, 8000])(
    'gives up at a bound of %i ms when an exporter never answers, then releases every signal',
    async (boundMs) => {
      const held = heldTimer();
      const signals = [signalFlushing(neverAnswered), signalFlushing(() => Promise.resolve())];
      const stopped = { instrumentations: false };

      const stopping = shutdownOf(
        signals,
        () => {
          stopped.instrumentations = true;
        },
        { boundMs, timer: held.timer },
      )();
      const asked = await held.asked;
      const releasedBeforeTheBound = signals.map(({ releases }) => releases());
      held.passes();
      await stopping;

      expect({ asked, releasedBeforeTheBound, stopped }).toEqual({
        asked: boundMs,
        releasedBeforeTheBound: [0, 0],
        stopped: { instrumentations: true },
      });
      expect(signals.map(({ releases }) => releases())).toEqual([1, 1]);
    },
  );

  it('ends at once, before its bound passes, when every exporter answers or fails, and releases every signal', async () => {
    const held = heldTimer();
    const signals = [
      signalFlushing(() => Promise.resolve()),
      signalFlushing(() => Promise.reject(new Error('the collector cannot be reached'))),
    ];

    await shutdownOf(signals, () => {}, { boundMs: longestShutdownMs, timer: held.timer })();

    expect(signals.map(({ releases }) => releases())).toEqual([1, 1]);
  });

  it('waits a second at most, as it ships', () => {
    expect(longestShutdownMs).toBe(1000);
  });
});

describe('telemetry whose collector takes its exports and never answers them', () => {
  it('sends what it holds as it shuts down, and stops once its bound passes, leaving them unanswered', async () => {
    const holding = await receivingOtlp({ answers: false });
    onTestFinished(holding.close);
    const traces = holding.receivedAt('/v1/traces');
    const telemetry = startTelemetry(readSettingsOf({ OTEL_EXPORTER_OTLP_ENDPOINT: holding.endpoint }).telemetry, {
      boundMs: longestShutdownMs,
      timer: () => traces,
    });
    trace.getTracer('test').startSpan('lost work').end();

    await telemetry.shutdown();

    expect(await traces).toMatchObject({ path: '/v1/traces' });
  });
});
