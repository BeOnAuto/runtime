import { setTimeout } from 'node:timers/promises';

import { Layer } from 'effect';

import { release } from '../composition/release.ts';
import { startInstrumentations } from './instrumentations.ts';
import { outboundTelemetry } from './outbound-telemetry.ts';
import { recordedEventsOf } from './recorded-events.ts';
import { requestTracing } from './request-tracing.ts';
import type { TelemetrySettings } from './telemetry-settings.ts';
import { signalsOf } from './telemetry-signals.ts';
import { noTelemetry, type Telemetry } from './telemetry.ts';

export { noTelemetry, type Telemetry } from './telemetry.ts';

const longestShutdownMs = 1000;

export function startTelemetry(settings: TelemetrySettings | undefined): Telemetry {
  if (settings === undefined) {
    return noTelemetry;
  }
  const signals = signalsOf(settings, release);
  const stopInstrumentations = startInstrumentations();
  return {
    layer: Layer.mergeAll(Layer.empty, ...signals.map(({ layer }) => layer)),
    requests: requestTracing(),
    appended: recordedEventsOf(settings.content),
    ...outboundTelemetry(settings.content),
    shutdown: async () => {
      stopInstrumentations();
      await Promise.race([
        Promise.allSettled(signals.map(({ flushed }) => flushed())),
        setTimeout(longestShutdownMs, undefined, { ref: false }),
      ]);
      for (const { released } of signals) {
        released();
      }
    },
  };
}
