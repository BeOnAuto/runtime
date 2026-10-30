import type { Environment } from '@on.auto/config';
import { Effect, Redacted } from 'effect';

import { countsIn } from '../function-settings/counted-settings.ts';
import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { nameValuesOf, type NameValues } from './name-value-lists.ts';

type TelemetrySignal = 'traces' | 'metrics' | 'logs';

type OtlpProtocol = 'http/protobuf' | 'http/json';

const samplerNames = [
  'always_on',
  'always_off',
  'traceidratio',
  'parentbased_always_on',
  'parentbased_always_off',
  'parentbased_traceidratio',
] as const;

export type SamplerName = (typeof samplerNames)[number];

export interface SignalExport {
  readonly url: string;
  readonly protocol: OtlpProtocol;
  readonly headers: Redacted.Redacted<NameValues>;
}

export interface SamplerSettings {
  readonly name: SamplerName;
  readonly ratio: number;
}

export interface TelemetrySettings {
  readonly traces: SignalExport | undefined;
  readonly metrics: SignalExport | undefined;
  readonly logs: SignalExport | undefined;
  readonly serviceName: string;
  readonly resourceAttributes: NameValues;
  readonly sampler: SamplerSettings;
  readonly metricExportIntervalMs: number;
  readonly content: boolean;
}

interface SharedExport {
  readonly endpoint: string | undefined;
  readonly protocol: OtlpProtocol;
  readonly headers: NameValues;
}

const signalNames: Readonly<Record<TelemetrySignal, string>> = { traces: 'TRACES', metrics: 'METRICS', logs: 'LOGS' };

const httpSchemes: ReadonlySet<string> = new Set(['http:', 'https:']);

const defaultServiceName = 'auto-runtime';

function invalid(setting: string, expected: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The telemetry settings are invalid. ${setting}: Expected ${expected}` });
}

function givenIn(environment: Environment, setting: string): string | undefined {
  const value = environment[setting]?.trim();
  return value === '' ? undefined : value;
}

function flagIn(environment: Environment, setting: string): Effect.Effect<boolean, InvalidSettingsError> {
  const value = givenIn(environment, setting)?.toLowerCase() ?? 'false';
  return value === 'true' || value === 'false'
    ? Effect.succeed(value === 'true')
    : Effect.fail(invalid(setting, 'true or false'));
}

function urlIn(environment: Environment, setting: string): Effect.Effect<string | undefined, InvalidSettingsError> {
  const value = givenIn(environment, setting);
  const url = value === undefined ? undefined : URL.parse(value);
  return url === null || (url !== undefined && !httpSchemes.has(url.protocol))
    ? Effect.fail(invalid(setting, 'an http or https URL such as http://collector:4318'))
    : Effect.succeed(url?.href);
}

function isProtocol(value: string): value is OtlpProtocol {
  return value === 'http/protobuf' || value === 'http/json';
}

function protocolIn(
  environment: Environment,
  setting: string,
  unset: OtlpProtocol,
): Effect.Effect<OtlpProtocol, InvalidSettingsError> {
  const value = givenIn(environment, setting) ?? unset;
  return isProtocol(value)
    ? Effect.succeed(value)
    : Effect.fail(invalid(setting, 'http/protobuf or http/json, since the runtime exports over HTTP alone'));
}

function nameValuesIn(environment: Environment, setting: string): Effect.Effect<NameValues, InvalidSettingsError> {
  const listed = nameValuesOf(givenIn(environment, setting) ?? '');
  return listed === undefined
    ? Effect.fail(invalid(setting, 'a list of name=value pairs separated by commas, such as name=value,other=value'))
    : Effect.succeed(listed);
}

function exportedIn(environment: Environment, setting: string): Effect.Effect<boolean, InvalidSettingsError> {
  const value = givenIn(environment, setting) ?? 'otlp';
  return value === 'otlp' || value === 'none'
    ? Effect.succeed(value === 'otlp')
    : Effect.fail(invalid(setting, 'otlp or none'));
}

function signalUrlOf(endpoint: string, signal: TelemetrySignal): string {
  const base = new URL(endpoint);
  const path = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return new URL(`${path}v1/${signal}`, base).href;
}

function signalVariablesOf(name: string) {
  return {
    exporter: `OTEL_${name}_EXPORTER`,
    endpoint: `OTEL_EXPORTER_OTLP_${name}_ENDPOINT`,
    protocol: `OTEL_EXPORTER_OTLP_${name}_PROTOCOL`,
    headers: `OTEL_EXPORTER_OTLP_${name}_HEADERS`,
  };
}

function signalExportIn(
  environment: Environment,
  signal: TelemetrySignal,
  shared: SharedExport,
): Effect.Effect<SignalExport | undefined, InvalidSettingsError> {
  const variables = signalVariablesOf(signalNames[signal]);
  return Effect.gen(function* () {
    const exported = yield* exportedIn(environment, variables.exporter);
    const own = yield* urlIn(environment, variables.endpoint);
    const protocol = yield* protocolIn(environment, variables.protocol, shared.protocol);
    const headers = yield* nameValuesIn(environment, variables.headers);
    const url = own ?? (shared.endpoint === undefined ? undefined : signalUrlOf(shared.endpoint, signal));
    return exported && url !== undefined
      ? { url, protocol, headers: Redacted.make({ ...shared.headers, ...headers }) }
      : undefined;
  });
}

function isSamplerName(value: string): value is SamplerName {
  return samplerNames.some((name) => name === value);
}

function samplerIn(environment: Environment): Effect.Effect<SamplerSettings, InvalidSettingsError> {
  const name = givenIn(environment, 'OTEL_TRACES_SAMPLER') ?? 'parentbased_always_on';
  const ratio = Number(givenIn(environment, 'OTEL_TRACES_SAMPLER_ARG') ?? '1');
  if (!isSamplerName(name)) {
    return Effect.fail(invalid('OTEL_TRACES_SAMPLER', `one of ${samplerNames.join(', ')}`));
  }
  return ratio >= 0 && ratio <= 1
    ? Effect.succeed({ name, ratio })
    : Effect.fail(invalid('OTEL_TRACES_SAMPLER_ARG', 'a ratio from 0 to 1, such as 0.25'));
}

function sharedExportIn(environment: Environment): Effect.Effect<SharedExport, InvalidSettingsError> {
  return Effect.all({
    endpoint: urlIn(environment, 'OTEL_EXPORTER_OTLP_ENDPOINT'),
    protocol: protocolIn(environment, 'OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf'),
    headers: nameValuesIn(environment, 'OTEL_EXPORTER_OTLP_HEADERS'),
  });
}

function exportsIn(
  environment: Environment,
): Effect.Effect<Pick<TelemetrySettings, TelemetrySignal>, InvalidSettingsError> {
  return Effect.flatMap(sharedExportIn(environment), (shared) =>
    Effect.all({
      traces: signalExportIn(environment, 'traces', shared),
      metrics: signalExportIn(environment, 'metrics', shared),
      logs: signalExportIn(environment, 'logs', shared),
    }),
  );
}

const metricExportInterval = {
  setting: 'OTEL_METRIC_EXPORT_INTERVAL',
  least: 1000,
  most: 3_600_000,
  example: 60_000,
};

export const telemetryVariables: readonly string[] = [
  ...Object.values(signalNames).flatMap((name) => Object.values(signalVariablesOf(name))),
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_TRACES_SAMPLER',
  'OTEL_TRACES_SAMPLER_ARG',
  'OTEL_SDK_DISABLED',
  'OTEL_RESOURCE_ATTRIBUTES',
  metricExportInterval.setting,
  'TELEMETRY_CONTENT',
  'OTEL_SERVICE_NAME',
];

export function readTelemetrySettings(
  environment: Environment,
): Effect.Effect<TelemetrySettings | undefined, InvalidSettingsError> {
  return Effect.gen(function* () {
    const disabled = yield* flagIn(environment, 'OTEL_SDK_DISABLED');
    const exports = yield* exportsIn(environment);
    const resourceAttributes = yield* nameValuesIn(environment, 'OTEL_RESOURCE_ATTRIBUTES');
    const sampler = yield* samplerIn(environment);
    const { metricExportIntervalMs } = yield* countsIn(environment, {
      settings: 'telemetry settings',
      bounds: { metricExportIntervalMs: metricExportInterval },
    });
    const content = yield* flagIn(environment, 'TELEMETRY_CONTENT');
    const exported = Object.values(exports).some((target) => target !== undefined);
    return disabled || !exported
      ? undefined
      : {
          ...exports,
          serviceName:
            givenIn(environment, 'OTEL_SERVICE_NAME') ?? resourceAttributes['service.name'] ?? defaultServiceName,
          resourceAttributes,
          sampler,
          metricExportIntervalMs,
          content,
        };
  });
}
