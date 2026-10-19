import type { Environment } from '@on.auto/config';
import {
  autoIdentityService,
  readApiKeys,
  type ApiKey,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import type { LogFormat, LogLevelSetting } from '../logging/log-formats.ts';
import { readStudioSettings } from '../studio/studio-settings.ts';
import { asInvalidSettings, InvalidSettingsError } from './invalid-settings-error.ts';
import { httpOffTheLoopbackIn, IssuerOrigin, Origin, PublicOrigin } from './origin.ts';

export const accessVariables: readonly string[] = [
  'ALLOWED_ORIGINS',
  'LOG_FORMAT',
  'LOG_LEVEL',
  'PUBLIC_URL',
  'IDENTITY_ISSUER',
];

export interface AccessSettings {
  readonly allowedOrigins: readonly string[];
  readonly logFormat: LogFormat;
  readonly logLevel: LogLevelSetting;
}

const accessSettings = Config.all({
  allowedOrigins: Config.Array(Origin, 'ALLOWED_ORIGINS').pipe(Config.withDefault([])),
  logFormat: Config.Literals(['json', 'pretty', 'console'], 'LOG_FORMAT').pipe(Config.withDefault('json')),
  logLevel: Config.Literals(['debug', 'info', 'warn', 'error'], 'LOG_LEVEL').pipe(Config.withDefault('info')),
});

export function readAccessSettings(environment: Environment): Effect.Effect<AccessSettings, InvalidSettingsError> {
  return asInvalidSettings(accessSettings.parse(ConfigProvider.fromEnvRecord(environment)));
}

export interface CredentialSettings {
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly identityIssuer: string;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
}

const signInSettings = Config.all({
  publicUrl: Config.option(Config.schema(PublicOrigin, 'PUBLIC_URL')),
  issuer: Config.schema(IssuerOrigin, 'IDENTITY_ISSUER').pipe(Config.withDefault(autoIdentityService)),
});

export function readCredentialSettings(environment: Environment, host: string): CredentialSettings {
  const { publicUrl, issuer } = Effect.runSync(
    asInvalidSettings(signInSettings.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  const refusal = Option.isSome(publicUrl) ? httpOffTheLoopbackIn('PUBLIC_URL', publicUrl.value) : undefined;
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  const apiKeys = readApiKeys(environment);
  const signIn = Option.isSome(publicUrl) ? { issuer, publicUrl: publicUrl.value } : undefined;
  const studio = readStudioSettings(environment, { host, apiKeys, signIn });
  return { apiKeys, identityIssuer: issuer, signIn, studio };
}
