import type { Environment } from '@on.auto/config';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import type { NameValues } from './name-value-lists.ts';
import type { SignalExport } from './telemetry-settings.ts';

function errorFrom(environment: Environment): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

function telemetryOf(environment: Environment) {
  return readSettingsOf(environment).telemetry;
}

function headersOf(target: SignalExport | undefined): NameValues {
  return target === undefined ? {} : Redacted.value(target.headers);
}

const collector = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' };

const invalidPrefix = 'InvalidSettingsError: The telemetry settings are invalid.';

describe('the telemetry settings', () => {
  it('leave telemetry off when no OTLP endpoint is set', () => {
    expect(telemetryOf({ OTEL_SERVICE_NAME: 'payments' })).toBeUndefined();
  });

  it('read a setting of nothing but blank space as not set', () => {
    expect(telemetryOf({ ...collector, OTEL_SERVICE_NAME: '  ' })?.serviceName).toBe('auto-runtime');
  });

  it('leave telemetry off when OTEL_SDK_DISABLED is true, whatever endpoint is set', () => {
    expect(telemetryOf({ ...collector, OTEL_SDK_DISABLED: 'TRUE' })).toBeUndefined();
  });

  it('leave telemetry off when every signal is exported to none', () => {
    expect(
      telemetryOf({
        ...collector,
        OTEL_TRACES_EXPORTER: 'none',
        OTEL_METRICS_EXPORTER: 'none',
        OTEL_LOGS_EXPORTER: 'none',
      }),
    ).toBeUndefined();
  });

  it('export every signal below the base endpoint over http/protobuf by default, as auto-runtime', () => {
    expect(telemetryOf({ ...collector, OTEL_SDK_DISABLED: 'false' })).toMatchObject({
      traces: { url: 'http://collector:4318/v1/traces', protocol: 'http/protobuf' },
      metrics: { url: 'http://collector:4318/v1/metrics', protocol: 'http/protobuf' },
      logs: { url: 'http://collector:4318/v1/logs', protocol: 'http/protobuf' },
      serviceName: 'auto-runtime',
      resourceAttributes: {},
      sampler: { name: 'parentbased_always_on', ratio: 1 },
      metricExportIntervalMs: 60_000,
      content: false,
    });
  });

  it('append each signal to the path of the base endpoint', () => {
    expect([
      telemetryOf({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp' })?.traces?.url,
      telemetryOf({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp/' })?.logs?.url,
    ]).toEqual(['https://otlp.example.com/otlp/v1/traces', 'https://otlp.example.com/otlp/v1/logs']);
  });
});

describe('the telemetry settings of one signal', () => {
  it('take the endpoint of the signal as given, and export only the signals with an endpoint', () => {
    expect(
      telemetryOf({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://tempo:4318/v1/traces', OTEL_SERVICE_NAME: 'payments' }),
    ).toMatchObject({
      traces: { url: 'http://tempo:4318/v1/traces' },
      metrics: undefined,
      logs: undefined,
      serviceName: 'payments',
    });
  });

  it('leave out a signal exported to none', () => {
    expect(telemetryOf({ ...collector, OTEL_METRICS_EXPORTER: 'none', OTEL_LOGS_EXPORTER: 'otlp' })).toMatchObject({
      metrics: undefined,
      logs: { url: 'http://collector:4318/v1/logs' },
    });
  });

  it('take the protocol of the signal before the shared one', () => {
    expect(
      telemetryOf({
        ...collector,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/protobuf',
      }),
    ).toMatchObject({ traces: { protocol: 'http/json' }, logs: { protocol: 'http/protobuf' } });
  });

  it('send the shared headers and the headers of the signal, decoded and kept secret', () => {
    const telemetry = telemetryOf({
      ...collector,
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=secret%20one, x-tenant=acme',
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-api-key=secret two,,',
    });

    expect(JSON.stringify(telemetry)).not.toContain('secret');
    expect([headersOf(telemetry?.traces), headersOf(telemetry?.metrics)]).toEqual([
      { 'x-api-key': 'secret two', 'x-tenant': 'acme' },
      { 'x-api-key': 'secret one', 'x-tenant': 'acme' },
    ]);
  });
});

describe('the telemetry settings of the resource, the sampler and the content', () => {
  it('describe the resource with OTEL_RESOURCE_ATTRIBUTES and take its service.name', () => {
    expect(
      telemetryOf({ ...collector, OTEL_RESOURCE_ATTRIBUTES: 'service.name=billing,deployment.environment.name=prod' }),
    ).toMatchObject({
      serviceName: 'billing',
      resourceAttributes: { 'service.name': 'billing', 'deployment.environment.name': 'prod' },
    });
  });

  it('sample with the sampler and the ratio given', () => {
    expect(
      telemetryOf({ ...collector, OTEL_TRACES_SAMPLER: 'parentbased_traceidratio', OTEL_TRACES_SAMPLER_ARG: '0.25' }),
    ).toMatchObject({ sampler: { name: 'parentbased_traceidratio', ratio: 0.25 } });
  });

  it('export metrics every OTEL_METRIC_EXPORT_INTERVAL milliseconds, and record content when asked', () => {
    expect(
      telemetryOf({ ...collector, OTEL_METRIC_EXPORT_INTERVAL: '15000', TELEMETRY_CONTENT: 'true' }),
    ).toMatchObject({ metricExportIntervalMs: 15_000, content: true });
  });
});

const invalidSettings: ReadonlyArray<readonly [Environment, string]> = [
  [{ OTEL_SDK_DISABLED: 'yes' }, 'OTEL_SDK_DISABLED: Expected true or false'],
  [{ TELEMETRY_CONTENT: '1' }, 'TELEMETRY_CONTENT: Expected true or false'],
  [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4318' }, 'OTEL_EXPORTER_OTLP_ENDPOINT: Expected an http or https URL'],
  [
    { OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'not a url' },
    'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: Expected an http or https URL',
  ],
  [
    { OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' },
    'OTEL_EXPORTER_OTLP_PROTOCOL: Expected http/protobuf or http/json, since the runtime exports over HTTP alone',
  ],
  [{ OTEL_TRACES_EXPORTER: 'console' }, 'OTEL_TRACES_EXPORTER: Expected otlp or none'],
  [{ OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key' }, 'OTEL_EXPORTER_OTLP_HEADERS: Expected a list of name=value pairs'],
  [{ OTEL_RESOURCE_ATTRIBUTES: 'team=%E0%A4%A' }, 'OTEL_RESOURCE_ATTRIBUTES: Expected a list of name=value pairs'],
  [{ OTEL_TRACES_SAMPLER: 'sometimes' }, 'OTEL_TRACES_SAMPLER: Expected one of always_on, always_off, traceidratio'],
  [{ OTEL_TRACES_SAMPLER_ARG: '1.5' }, 'OTEL_TRACES_SAMPLER_ARG: Expected a ratio from 0 to 1, such as 0.25'],
  [
    { OTEL_METRIC_EXPORT_INTERVAL: '10' },
    'OTEL_METRIC_EXPORT_INTERVAL: Expected a whole number from 1000 to 3600000, such as 60000',
  ],
];

describe('the telemetry settings that cannot be read', () => {
  it.each(invalidSettings)('stop the server at start for %j, naming the setting', (environment, expected) => {
    expect(errorFrom(environment)).toContain(`${invalidPrefix} ${expected}`);
  });
});
