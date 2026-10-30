import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { OTLPTraceExporter as JsonTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as ProtobufTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { BatchSpanProcessor, NodeTracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace-node';
import { Layer } from 'effect';

import {
  effectResourceOf,
  exporterOptionsOf,
  otelResourceOf,
  type ResourceDescription,
} from './resource-description.ts';
import type { SignalTelemetry } from './signal-telemetry.ts';
import { samplerOf } from './telemetry-sampler.ts';
import type { SamplerSettings, SignalExport } from './telemetry-settings.ts';

function spanExporterOf(target: SignalExport): SpanExporter {
  return target.protocol === 'http/json'
    ? new JsonTraceExporter(exporterOptionsOf(target))
    : new ProtobufTraceExporter(exporterOptionsOf(target));
}

export function startTraces(
  target: SignalExport,
  sampler: SamplerSettings,
  resource: ResourceDescription,
): SignalTelemetry {
  const provider = new NodeTracerProvider({
    resource: otelResourceOf(resource),
    sampler: samplerOf(sampler),
    spanProcessors: [new BatchSpanProcessor(spanExporterOf(target))],
  });
  provider.register();
  return {
    layer: OtelTracer.layerGlobal.pipe(Layer.provide(effectResourceOf(resource))),
    flushed: () => provider.shutdown(),
    released: () => {
      trace.disable();
      propagation.disable();
      context.disable();
    },
  };
}
