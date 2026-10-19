import type { Environment } from '@on.auto/config';
import { autoIdentityService, readApiKeys, type ApiKey, type SignInSettings } from '@on.auto/identity';
import { alternatives, loopbackNames, namesTheLoopback } from '@on.auto/operations';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import type { LogFormat, LogLevelSetting } from '../logging/log-formats.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';
import { IssuerOrigin, Origin, PublicOrigin } from './origin.ts';

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

function asInvalidSettings<A>(
  parsing: Effect.Effect<A, { readonly message: string }>,
): Effect.Effect<A, InvalidSettingsError> {
  return parsing.pipe(Effect.mapError(({ message }) => new InvalidSettingsError({ message })));
}

export function readAccessSettings(environment: Environment): Effect.Effect<AccessSettings, InvalidSettingsError> {
  return asInvalidSettings(accessSettings.parse(ConfigProvider.fromEnvRecord(environment)));
}

export interface CredentialSettings {
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly identityIssuer: string;
  readonly signIn: SignInSettings | undefined;
}

const signInSettings = Config.all({
  publicUrl: Config.option(Config.schema(PublicOrigin, 'PUBLIC_URL')),
  issuer: Config.schema(IssuerOrigin, 'IDENTITY_ISSUER').pipe(Config.withDefault(autoIdentityService)),
});

const httpOffLoopback = `PUBLIC_URL: Expected an https URL; an http URL is taken only for ${alternatives(loopbackNames)}`;

function isUsable(publicUrl: string): boolean {
  return publicUrl.startsWith('https://') || namesTheLoopback(new URL(publicUrl).hostname);
}

export function readCredentialSettings(environment: Environment): CredentialSettings {
  const { publicUrl, issuer } = Effect.runSync(
    asInvalidSettings(signInSettings.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  if (Option.isSome(publicUrl) && !isUsable(publicUrl.value)) {
    throw new InvalidSettingsError({ message: httpOffLoopback });
  }
  return {
    apiKeys: readApiKeys(environment),
    identityIssuer: issuer,
    signIn: Option.isSome(publicUrl) ? { issuer, publicUrl: publicUrl.value } : undefined,
  };
}
