import type { Environment } from '@on.auto/config';
import { contentLocationOf, type ContentLocation } from '@on.auto/object-storage/location';
import { mostShownFieldBytes } from '@on.auto/operations';
import { mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { Config, ConfigProvider, Effect, Option, Schema } from 'effect';

import { countOf } from '../function-settings/counted-settings.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';

export type ContentSettings =
  | { readonly store: 'ledger' }
  | {
      readonly store: 'object-storage';
      readonly location: ContentLocation;
      readonly endpoint: string | undefined;
      readonly region: string | undefined;
    };

export const contentVariables: readonly string[] = [
  'CONTENT_STORE_URL',
  'AWS_ENDPOINT_URL_S3',
  'AWS_ENDPOINT_URL',
  'AWS_REGION',
];

const sources = Config.all({
  url: Config.option(Config.String('CONTENT_STORE_URL')),
  storageEndpoint: Config.option(Config.String('AWS_ENDPOINT_URL_S3')),
  endpoint: Config.option(Config.String('AWS_ENDPOINT_URL')),
  region: Config.option(Config.String('AWS_REGION')),
});

const httpSchemes: ReadonlySet<string> = new Set(['http:', 'https:']);

function invalid(detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The content store settings are invalid. ${detail}` });
}

function endpointOf(
  setting: string,
  given: string | undefined,
): Effect.Effect<string | undefined, InvalidSettingsError> {
  if (given === undefined) {
    return Effect.succeed(given);
  }
  const url = given.trim();
  const parsed = URL.parse(url);
  return parsed !== null && httpSchemes.has(parsed.protocol)
    ? Effect.succeed(url)
    : Effect.fail(invalid(`${setting}: Expected an http or https URL such as https://storage.example.com`));
}

function locationOf(url: string): Effect.Effect<ContentLocation, InvalidSettingsError> {
  const location = contentLocationOf(url);
  return location === undefined
    ? Effect.fail(
        invalid(
          'CONTENT_STORE_URL: Expected an S3 URL such as s3://bucket/prefix, whose bucket is 3 to 63 lowercase letters, digits, dots and hyphens',
        ),
      )
    : Effect.succeed(location);
}

export function readContentSettings(environment: Environment): Effect.Effect<ContentSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const { url, storageEndpoint, endpoint, region } = yield* Effect.orDie(
      sources.parse(ConfigProvider.fromEnvRecord(environment)),
    );
    if (Option.isNone(url)) {
      return { store: 'ledger' };
    }
    return {
      store: 'object-storage',
      location: yield* locationOf(url.value),
      endpoint: Option.isSome(storageEndpoint)
        ? yield* endpointOf('AWS_ENDPOINT_URL_S3', storageEndpoint.value)
        : yield* endpointOf('AWS_ENDPOINT_URL', Option.getOrUndefined(endpoint)),
      region: Option.getOrUndefined(region),
    };
  });
}

export interface PayloadSettings {
  readonly offloading: boolean;
  readonly sizeThresholdBytes: number;
}

const leastPayloadSizeThresholdBytes = mostShownFieldBytes;

const mostPayloadSizeThresholdBytes = 65_536;

const defaultPayloadSizeThresholdBytes = mostInlinePayloadBytes;

export const defaultPayloadSettings: PayloadSettings = {
  offloading: true,
  sizeThresholdBytes: defaultPayloadSizeThresholdBytes,
};

const offloadingSetting = 'PAYLOAD_OFFLOADING';

const thresholdSetting = 'PAYLOAD_SIZE_THRESHOLD_BYTES';

export const payloadVariables: readonly string[] = [offloadingSetting, thresholdSetting];

export const PayloadSizeThresholdBytes = Schema.Int.check(
  Schema.isBetween({ minimum: leastPayloadSizeThresholdBytes, maximum: mostPayloadSizeThresholdBytes }),
);

const switchValues: ReadonlyMap<string, boolean> = new Map([
  ['', defaultPayloadSettings.offloading],
  ['true', true],
  ['false', false],
]);

function writtenIn(environment: Environment, setting: string): string {
  return (environment[setting] ?? '').trim();
}

function offloadingIn(environment: Environment): boolean | undefined {
  return switchValues.get(writtenIn(environment, offloadingSetting).toLowerCase());
}

function thresholdIn(environment: Environment): number {
  const written = writtenIn(environment, thresholdSetting);
  return written === '' ? defaultPayloadSizeThresholdBytes : countOf(written);
}

function isWithinItsBounds(threshold: number): boolean {
  return threshold >= leastPayloadSizeThresholdBytes && threshold <= mostPayloadSizeThresholdBytes;
}

export function readPayloadSettings(environment: Environment): Effect.Effect<PayloadSettings, InvalidSettingsError> {
  const offloading = offloadingIn(environment);
  const sizeThresholdBytes = thresholdIn(environment);
  const problems = [
    ...(offloading === undefined ? [`${offloadingSetting}: Expected true or false`] : []),
    ...(isWithinItsBounds(sizeThresholdBytes)
      ? []
      : [
          `${thresholdSetting}: Expected a whole number from ${leastPayloadSizeThresholdBytes} to ${mostPayloadSizeThresholdBytes}, such as ${defaultPayloadSizeThresholdBytes}`,
        ]),
  ];
  return offloading === undefined || problems.length > 0
    ? Effect.fail(new InvalidSettingsError({ message: `The payload settings are invalid. ${problems.join('; ')}` }))
    : Effect.succeed({ offloading, sizeThresholdBytes });
}
