import type { Environment } from '@on.auto/config';
import {
  accessModeOf,
  listensOnlyOnLoopback,
  loopbackNames,
  namesTheLoopback,
  readApiKeys,
  type ApiKey,
  type DeclaredAccessMode,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { alternatives } from '@on.auto/phrasing';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import type { LogFormat, LogLevelSetting } from '../logging/log-formats.ts';
import { readStudioSettings } from '../studio/studio-settings.ts';
import { asInvalidSettings, InvalidSettingsError } from './invalid-settings-error.ts';
import {
  openIdConnectVariables,
  readOpenIdConnectSettings,
  type OpenIdConnectRead,
  type OpenIdConnectSettings,
} from './openid-connect-settings.ts';
import { httpOffTheLoopbackIn, Origin, PublicOrigin } from './origin.ts';
import { readWebhookUrl, receivingVariables } from './receiving-settings.ts';

export const accessVariables: readonly string[] = [
  'ALLOWED_ORIGINS',
  'LOG_FORMAT',
  'LOG_LEVEL',
  'PUBLIC_URL',
  ...receivingVariables,
  'ACCESS_MODE',
  ...openIdConnectVariables,
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

export interface CredentialSettings extends OpenIdConnectRead {
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly publicUrl: string | undefined;
  readonly accessMode: DeclaredAccessMode | undefined;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
}

const signInSettings = Config.all({
  publicUrl: Config.option(Config.schema(PublicOrigin, 'PUBLIC_URL')),
  accessMode: Config.option(Config.Literals(['local'], 'ACCESS_MODE')),
});

const unsupportedSettings: readonly string[] = ['IDENTITY_ISSUER', 'IDENTITY_JWKS', 'IDENTITY_JWKS_URL'];

function unsupported(setting: string): string {
  return `${setting}: is no longer supported, so leave it out; a runtime with PUBLIC_URL signs people in itself, with their Auto accounts, or through the identity provider OIDC_ISSUER names`;
}

function unsupportedSettingRefusalOf(environment: Environment): string | undefined {
  const given = unsupportedSettings.find((setting) => (environment[setting] ?? '') !== '');
  return given === undefined ? undefined : unsupported(given);
}

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

const webhookInLocalMode =
  'WEBHOOK_URL: local mode takes no WEBHOOK_URL, since in local mode every request acts as the local developer; set PUBLIC_URL with no ACCESS_MODE, or leave WEBHOOK_URL out';

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
  const httpRefusal =
    publicUrl === undefined ? undefined : httpOffTheLoopbackIn('PUBLIC_URL', publicUrl, 'ACCESS_MODE=local');
  return httpRefusal ?? (accessMode === undefined ? undefined : localModeRefusalOf(declaring));
}

function webhookRefusalOf(environment: Environment, inLocalMode: boolean): string | undefined {
  return inLocalMode && readWebhookUrl(environment) !== undefined ? webhookInLocalMode : undefined;
}

function refusedIf(refusal: string | undefined): void {
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
}

function signInOf(signingIn: OpenIdConnectSettings | undefined): SignInSettings | undefined {
  return signingIn === undefined ? undefined : { issuer: signingIn.issuer, publicUrl: signingIn.publicUrl };
}

export function readCredentialSettings(
  environment: Environment,
  host: string,
  defaults?: Parameters<typeof readOpenIdConnectSettings>[2],
): CredentialSettings {
  refusedIf(unsupportedSettingRefusalOf(environment));
  const read = Effect.runSync(asInvalidSettings(signInSettings.parse(ConfigProvider.fromEnvRecord(environment))));
  const [publicUrl, accessMode] = [Option.getOrUndefined(read.publicUrl), Option.getOrUndefined(read.accessMode)];
  const apiKeys = readApiKeys(environment);
  const signsIn = publicUrl !== undefined && accessMode === undefined;
  const inLocalMode = accessModeOf({ host, apiKeys, signsIn, accessMode }) === 'local';
  refusedIf(refusalOf({ host, apiKeys, publicUrl }, accessMode) ?? webhookRefusalOf(environment, inLocalMode));
  const { openIdConnect, openIdConnectByDefault } = readOpenIdConnectSettings(
    environment,
    { publicUrl, accessMode },
    defaults,
  );
  const signIn = signInOf(openIdConnect ?? openIdConnectByDefault);
  const studio = readStudioSettings(environment, { host, apiKeys, signIn, accessMode });
  return {
    apiKeys,
    publicUrl,
    accessMode,
    signIn,
    openIdConnect,
    openIdConnectByDefault,
    studio,
  };
}
