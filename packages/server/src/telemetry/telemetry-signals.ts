import type { ServerInfo } from '@on.auto/api';

import { startLogs } from './logs.ts';
import { startMetrics } from './metrics.ts';
import { resourceDescriptionOf } from './resource-description.ts';
import type { SignalTelemetry } from './signal-telemetry.ts';
import type { TelemetrySettings } from './telemetry-settings.ts';
import { startTraces } from './traces.ts';

export function signalsOf(settings: TelemetrySettings, release: ServerInfo): readonly SignalTelemetry[] {
  const resource = resourceDescriptionOf(settings, release);
  const { traces, metrics, logs } = settings;
  return [
    ...(traces === undefined ? [] : [startTraces(traces, settings.sampler, resource)]),
    ...(metrics === undefined ? [] : [startMetrics(metrics, settings.metricExportIntervalMs, resource)]),
    ...(logs === undefined ? [] : [startLogs(logs, resource)]),
  ];
}
