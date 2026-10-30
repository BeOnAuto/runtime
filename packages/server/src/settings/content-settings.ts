import type { Environment } from '@on.auto/config';
import { contentLocationOf, type ContentLocation } from '@on.auto/object-storage/location';
import { Config, ConfigProvider, Effect, Option } from 'effect';

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
