import * as OtelMetrics from '@effect/opentelemetry/OtelMetrics';
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter as JsonMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPMetricExporter as ProtobufMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { MeterProvider, PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { Effect, Layer } from 'effect';

import {
  effectResourceOf,
  exporterOptionsOf,
  otelResourceOf,
  type ResourceDescription,
} from './resource-description.ts';
import type { SignalTelemetry } from './signal-telemetry.ts';
import type { SignalExport } from './telemetry-settings.ts';

const longestExportMs = 30_000;

function metricExporterOf(target: SignalExport): PushMetricExporter {
  return target.protocol === 'http/json'
    ? new JsonMetricExporter(exporterOptionsOf(target))
    : new ProtobufMetricExporter(exporterOptionsOf(target));
}

export function startMetrics(target: SignalExport, intervalMs: number, resource: ResourceDescription): SignalTelemetry {
  const effectMetrics = Effect.runSync(OtelMetrics.makeProducer().pipe(Effect.provide(effectResourceOf(resource))));
  const provider = new MeterProvider({
    resource: otelResourceOf(resource),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporterOf(target),
        exportIntervalMillis: intervalMs,
        exportTimeoutMillis: Math.min(longestExportMs, intervalMs),
        metricProducers: [effectMetrics],
      }),
    ],
  });
  metrics.setGlobalMeterProvider(provider);
  return {
    layer: Layer.empty,
    flushed: () => provider.shutdown(),
    released: () => {
      metrics.disable();
    },
  };
}
