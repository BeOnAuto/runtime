import { Layer } from 'effect';

import { release } from '../composition/release.ts';
import { startInstrumentations } from './instrumentations.ts';
import { outboundTelemetry } from './outbound-telemetry.ts';
import { recordedEventsOf } from './recorded-events.ts';
import { requestTracing } from './request-tracing.ts';
import type { TelemetrySettings } from './telemetry-settings.ts';
import { shippedBound, shutdownOf, type ShutdownBound } from './telemetry-shutdown.ts';
import { signalsOf } from './telemetry-signals.ts';
import { noTelemetry, type Telemetry } from './telemetry.ts';

export { noTelemetry, type Telemetry } from './telemetry.ts';

export function startTelemetry(
  settings: TelemetrySettings | undefined,
  bound: ShutdownBound = shippedBound,
): Telemetry {
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
    shutdown: shutdownOf(signals, stopInstrumentations, bound),
  };
}
