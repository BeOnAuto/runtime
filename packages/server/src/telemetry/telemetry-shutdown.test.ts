import { setTimeout } from 'node:timers/promises';

import { trace } from '@opentelemetry/api';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { until } from '../testing/waiting/until.ts';
import { longestShutdownMs, startTelemetry } from './start-telemetry.ts';

const stopped = 'stopped';

function stoppedOrItsBoundPassed(endpoint: string): Promise<string> {
  const telemetry = startTelemetry(readSettingsOf({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }).telemetry);
  trace.getTracer('test').startSpan('lost work').end();
  const stopping = telemetry.shutdown().then(() => stopped);
  return Promise.race([stopping, setTimeout(longestShutdownMs, 'its bound passed')]);
}

function heardTraces(paths: readonly string[]): boolean {
  return paths.includes('/v1/traces');
}

describe('telemetry whose collector takes its exports and never answers them', () => {
  it('stops at its bound of a second, before a timer of that second started after it, leaving them unanswered', async () => {
    const holding = await receivingOtlp({ answers: false });
    onTestFinished(holding.close);

    const ended = await stoppedOrItsBoundPassed(holding.endpoint);
    const heard = await until(() => holding.received().map(({ path }) => path), heardTraces);

    expect(ended).toBe(stopped);
    expect(heard).toContain('/v1/traces');
  });
});

describe('telemetry whose collector cannot be reached', () => {
  it('stops at its bound of a second, before a timer of that second started after it, leaving behind what it could not send', async () => {
    const gone = await receivingOtlp();
    await gone.close();

    expect(await stoppedOrItsBoundPassed(gone.endpoint)).toBe(stopped);
  });
});
