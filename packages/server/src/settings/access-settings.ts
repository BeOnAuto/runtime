import type { Environment } from '@on.auto/config';
import {
  autoIdentityService,
  IssuerKeySetSchema,
  listensOnlyOnLoopback,
  readApiKeys,
  type ApiKey,
  type DeclaredAccessMode,
  type IssuerKeySet,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { alternatives, loopbackNames, namesTheLoopback } from '@on.auto/operations';
import { Config, ConfigProvider, Effect, Option, Schema } from 'effect';

import type { LogFormat, LogLevelSetting } from '../logging/log-formats.ts';
import { readStudioSettings } from '../studio/studio-settings.ts';
import { asInvalidSettings, InvalidSettingsError } from './invalid-settings-error.ts';
import { httpOffTheLoopbackIn, IssuerOrigin, KeySetUrl, Origin, PublicOrigin } from './origin.ts';

export const accessVariables: readonly string[] = [
  'ALLOWED_ORIGINS',
  'LOG_FORMAT',
  'LOG_LEVEL',
  'PUBLIC_URL',
  'ACCESS_MODE',
  'IDENTITY_ISSUER',
  'IDENTITY_JWKS',
  'IDENTITY_JWKS_URL',
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

export type IdentityKeySet =
  | { readonly from: 'discovery' }
  | { readonly from: 'given'; readonly keySet: IssuerKeySet }
  | { readonly from: 'url'; readonly url: string };

export interface CredentialSettings {
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly identityIssuer: string;
  readonly identityKeySet: IdentityKeySet;
  readonly publicUrl: string | undefined;
  readonly accessMode: DeclaredAccessMode | undefined;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
}

const signInSettings = Config.all({
  publicUrl: Config.option(Config.schema(PublicOrigin, 'PUBLIC_URL')),
  issuer: Config.schema(IssuerOrigin, 'IDENTITY_ISSUER').pipe(Config.withDefault(autoIdentityService)),
  keySet: Config.option(Config.schema(Schema.fromJsonString(IssuerKeySetSchema), 'IDENTITY_JWKS')),
  keySetUrl: Config.option(Config.schema(KeySetUrl, 'IDENTITY_JWKS_URL')),
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

const keySetGivenTwice = 'IDENTITY_JWKS: Set one of IDENTITY_JWKS and IDENTITY_JWKS_URL, not more';

interface KeySetGiven {
  readonly keySet: IssuerKeySet | undefined;
  readonly url: string | undefined;
}

function keySetRefusalOf({ keySet, url }: KeySetGiven): string | undefined {
  return keySet !== undefined && url !== undefined ? keySetGivenTwice : undefined;
}

function identityKeySetOf({ keySet, url }: KeySetGiven): IdentityKeySet {
  if (keySet !== undefined) {
    return { from: 'given', keySet };
  }
  return url === undefined ? { from: 'discovery' } : { from: 'url', url };
}

function refusalOf(declaring: Declaring, accessMode: DeclaredAccessMode | undefined): string | undefined {
  const { publicUrl } = declaring;
  const httpRefusal = publicUrl === undefined ? undefined : httpOffTheLoopbackIn('PUBLIC_URL', publicUrl);
  return httpRefusal ?? (accessMode === undefined ? undefined : localModeRefusalOf(declaring));
}

export function readCredentialSettings(environment: Environment, host: string): CredentialSettings {
  const read = Effect.runSync(asInvalidSettings(signInSettings.parse(ConfigProvider.fromEnvRecord(environment))));
  const [publicUrl, accessMode] = [Option.getOrUndefined(read.publicUrl), Option.getOrUndefined(read.accessMode)];
  const keySetGiven = { keySet: Option.getOrUndefined(read.keySet), url: Option.getOrUndefined(read.keySetUrl) };
  const apiKeys = readApiKeys(environment);
  const refusal = refusalOf({ host, apiKeys, publicUrl }, accessMode) ?? keySetRefusalOf(keySetGiven);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  const signsIn = publicUrl !== undefined && accessMode === undefined;
  const signIn = signsIn ? { issuer: read.issuer, publicUrl } : undefined;
  const studio = readStudioSettings(environment, { host, apiKeys, signIn, accessMode });
  return {
    apiKeys,
    identityIssuer: read.issuer,
    identityKeySet: identityKeySetOf(keySetGiven),
    publicUrl,
    accessMode,
    signIn,
    studio,
  };
}
