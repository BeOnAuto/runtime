import type { Environment } from '@on.auto/config';
import {
  autoIdentityService,
  listensOnlyOnLoopback,
  readApiKeys,
  type ApiKey,
  type DeclaredAccessMode,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { alternatives, loopbackNames, namesTheLoopback } from '@on.auto/operations';
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
  'ACCESS_MODE',
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
  readonly publicUrl: string | undefined;
  readonly accessMode: DeclaredAccessMode | undefined;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
}

const signInSettings = Config.all({
  publicUrl: Config.option(Config.schema(PublicOrigin, 'PUBLIC_URL')),
  issuer: Config.schema(IssuerOrigin, 'IDENTITY_ISSUER').pipe(Config.withDefault(autoIdentityService)),
  accessMode: Config.option(Config.Literals(['local'], 'ACCESS_MODE')),
});

interface Declaring {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly publicUrl: string | undefined;
}

const keysInLocalMode =
  'ACCESS_MODE: local takes no API_KEYS, since in local mode every request acts as the local developer; set one or the other';

const publicInLocalMode = `ACCESS_MODE: local takes a PUBLIC_URL only on ${alternatives(loopbackNames)}, since a runtime at a public address is never in local mode`;

function addressNeededOn(host: string): string {
  return `ACCESS_MODE: local on HOST ${host} needs PUBLIC_URL, the address on ${alternatives(loopbackNames)} at which this computer reaches the runtime, such as http://localhost:5555, since local mode refuses a request whose Host names ${host}`;
}

function localModeRefusalOf({ host, apiKeys, publicUrl }: Declaring): string | undefined {
  if (apiKeys !== undefined) {
    return keysInLocalMode;
  }
  if (publicUrl === undefined) {
    return listensOnlyOnLoopback(host) ? undefined : addressNeededOn(host);
  }
  return namesTheLoopback(new URL(publicUrl).hostname) ? undefined : publicInLocalMode;
}

function refusalOf(declaring: Declaring, accessMode: DeclaredAccessMode | undefined): string | undefined {
  const { publicUrl } = declaring;
  const httpRefusal = publicUrl === undefined ? undefined : httpOffTheLoopbackIn('PUBLIC_URL', publicUrl);
  return httpRefusal ?? (accessMode === undefined ? undefined : localModeRefusalOf(declaring));
}

export function readCredentialSettings(environment: Environment, host: string): CredentialSettings {
  const read = Effect.runSync(asInvalidSettings(signInSettings.parse(ConfigProvider.fromEnvRecord(environment))));
  const [publicUrl, accessMode] = [Option.getOrUndefined(read.publicUrl), Option.getOrUndefined(read.accessMode)];
  const apiKeys = readApiKeys(environment);
  const refusal = refusalOf({ host, apiKeys, publicUrl }, accessMode);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  const signsIn = publicUrl !== undefined && accessMode === undefined;
  const signIn = signsIn ? { issuer: read.issuer, publicUrl } : undefined;
  const studio = readStudioSettings(environment, { host, apiKeys, signIn, accessMode });
  return { apiKeys, identityIssuer: read.issuer, publicUrl, accessMode, signIn, studio };
}
