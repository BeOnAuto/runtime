import type { Environment } from '@on.auto/config';
import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Effect, ManagedRuntime, Metric } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { release } from '../composition/release.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { logsIn, metricNamesIn, resourceIn, spansIn } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp, type OtlpReceiver, type ReceivedExport } from '../testing/telemetry/otlp-receiver.ts';
import { noTelemetry, startTelemetry } from './start-telemetry.ts';

async function collector(): Promise<OtlpReceiver> {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  return receiver;
}

const effectRuns = Metric.counter('auto.on.test.effect_runs');

async function exportedBy(environment: Environment): Promise<void> {
  const telemetry = startTelemetry(readSettingsOf(environment).telemetry);
  const runtime = ManagedRuntime.make(telemetry.layer);
  await runtime.runPromise(
    Effect.logInfo('working').pipe(Effect.andThen(Metric.update(effectRuns, 1)), Effect.withSpan('effect work')),
  );
  trace.getTracer('test').startSpan('api work').end();
  metrics.getMeter('test').createCounter('test.api_runs').add(1);
  logs.getLogger('test').emit({ eventName: 'thing_happened', attributes: { thing: 'x' } });
  await runtime.dispose();
  await telemetry.shutdown();
}

describe('telemetry whose collector cannot be reached', () => {
  it('stops within a second and a half, leaving behind what it could not send', async () => {
    const gone = await receivingOtlp();
    await gone.close();
    const telemetry = startTelemetry(readSettingsOf({ OTEL_EXPORTER_OTLP_ENDPOINT: gone.endpoint }).telemetry);
    trace.getTracer('test').startSpan('lost work').end();
    const stopping = performance.now();
    await telemetry.shutdown();

    expect(performance.now() - stopping).toBeLessThan(1500);
  });
});

describe('telemetry with no OTLP endpoint', () => {
  it('is no telemetry at all', () => {
    expect(startTelemetry(readSettingsOf({}).telemetry)).toBe(noTelemetry);
  });
});

describe('telemetry with an OTLP endpoint over http/json', () => {
  it('exports the spans, logs and metrics of Effect and of the OpenTelemetry API, describing the service', async () => {
    const receiver = await collector();
    await exportedBy({ OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' });
    const received = receiver.received();

    expect(spansIn(received).map(({ name }) => name)).toEqual(['effect work', 'api work']);
    expect(logsIn(received)).toMatchObject([
      { body: 'working', severityText: 'Info', traceId: spansIn(received)[0]?.traceId },
      { scope: 'test', eventName: 'thing_happened', body: undefined, attributes: { thing: 'x' } },
    ]);
    expect(metricNamesIn(received)).toEqual(expect.arrayContaining(['test.api_runs', 'auto.on.test.effect_runs']));
    expect(resourceIn(received)).toMatchObject({ 'service.name': 'auto-runtime', 'service.version': release.version });
  });
});

describe('telemetry with an OTLP endpoint over http/protobuf', () => {
  it('exports every signal as protobuf, below the endpoint', async () => {
    const receiver = await collector();
    await exportedBy({ OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint });

    expect(
      new Set(receiver.received().map(({ path, contentType }: ReceivedExport) => `${contentType} to ${path}`)),
    ).toEqual(
      new Set([
        'application/x-protobuf to /v1/traces',
        'application/x-protobuf to /v1/metrics',
        'application/x-protobuf to /v1/logs',
      ]),
    );
  });
});

describe('telemetry with an endpoint for traces alone', () => {
  it('exports nothing but the traces', async () => {
    const receiver = await collector();
    await exportedBy({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${receiver.endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    });

    expect(new Set(receiver.received().map(({ path }: ReceivedExport) => path))).toEqual(new Set(['/v1/traces']));
  });
});
