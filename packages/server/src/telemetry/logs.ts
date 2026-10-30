import * as OtelLogger from '@effect/opentelemetry/OtelLogger';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter as JsonLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPLogExporter as ProtobufLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { BatchLogRecordProcessor, LoggerProvider, type LogRecordExporter } from '@opentelemetry/sdk-logs';
import { Layer } from 'effect';

import { exporterOptionsOf, otelResourceOf, type ResourceDescription } from './resource-description.ts';
import type { SignalTelemetry } from './signal-telemetry.ts';
import type { SignalExport } from './telemetry-settings.ts';

function logExporterOf(target: SignalExport): LogRecordExporter {
  return target.protocol === 'http/json'
    ? new JsonLogExporter(exporterOptionsOf(target))
    : new ProtobufLogExporter(exporterOptionsOf(target));
}

export function startLogs(target: SignalExport, resource: ResourceDescription): SignalTelemetry {
  const provider = new LoggerProvider({
    resource: otelResourceOf(resource),
    processors: [new BatchLogRecordProcessor({ exporter: logExporterOf(target) })],
  });
  logs.setGlobalLoggerProvider(provider);
  return {
    layer: OtelLogger.layer({ mergeWithExisting: true }).pipe(
      Layer.provide(Layer.succeed(OtelLogger.OtelLoggerProvider, provider)),
    ),
    flushed: () => provider.shutdown(),
    released: () => {
      logs.disable();
    },
  };
}
