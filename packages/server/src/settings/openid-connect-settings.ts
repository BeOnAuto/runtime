import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Environment } from '@on.auto/config';
import {
  clientAuthenticationMethods,
  type ClientAuthenticationMethod,
  type RequiredClaim,
} from '@on.auto/openid-connect';
import { Config, ConfigProvider, Effect, Option, Redacted, Schema } from 'effect';

import { asInvalidSettings, InvalidSettingsError } from './invalid-settings-error.ts';

export const openIdConnectVariables: readonly string[] = [
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_CLIENT_SECRET_FILE',
  'OIDC_SCOPES',
  'OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
  'OIDC_REQUIRED_CLAIM',
];

export const callbackPath = '/auth/oidc/callback';

export interface OpenIdConnectSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly scopes: readonly string[];
  readonly tokenEndpointAuthMethod: ClientAuthenticationMethod | undefined;
  readonly publicUrl: string;
  readonly redirectUri: string;
  readonly requiredClaim: RequiredClaim | undefined;
}

export interface OpenIdConnectDeciding {
  readonly publicUrl: string | undefined;
  readonly accessMode: 'local' | undefined;
}

const IssuerUrl = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      (URL.parse(text)?.protocol === 'https:' && !text.includes('?') && !text.includes('#')) ||
      "Expected the https URL of the identity provider's issuer, with no query or fragment, such as https://login.example.com/acme",
  ),
);

const requiredClaimForm = /^([^=\s](?:[^=]*[^=\s])?)=(\S(?:.*\S)?)$/su;

const RequiredClaimText = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      requiredClaimForm.test(text) ||
      'Expected claim=value: the name of a claim of the ID Token, then the value it must carry, with no space at the start or the end of either',
  ),
);

function requiredClaimOf(text: string | undefined): RequiredClaim | undefined {
  const [, claim, requiredValue] = requiredClaimForm.exec(String(text)) ?? [];
  return claim === undefined || requiredValue === undefined ? undefined : { claim, requiredValue };
}

const defaultScopes = 'openid profile email';

const settingsGiven = Config.all({
  issuer: Config.map(Config.option(Config.schema(IssuerUrl, 'OIDC_ISSUER')), Option.getOrUndefined),
  clientId: Config.map(Config.option(Config.schema(Schema.NonEmptyString, 'OIDC_CLIENT_ID')), Option.getOrUndefined),
  clientSecret: Config.map(Config.option(Config.Redacted('OIDC_CLIENT_SECRET')), Option.getOrUndefined),
  clientSecretFile: Config.map(Config.option(Config.String('OIDC_CLIENT_SECRET_FILE')), Option.getOrUndefined),
  scopes: Config.String('OIDC_SCOPES').pipe(Config.withDefault(defaultScopes)),
  tokenEndpointAuthMethod: Config.map(
    Config.option(Config.Literals(clientAuthenticationMethods, 'OIDC_TOKEN_ENDPOINT_AUTH_METHOD')),
    Option.getOrUndefined,
  ),
  requiredClaim: Config.map(
    Config.option(Config.schema(RequiredClaimText, 'OIDC_REQUIRED_CLAIM')),
    Option.getOrUndefined,
  ),
  identityIssuer: Config.map(Config.option(Config.String('IDENTITY_ISSUER')), Option.getOrUndefined),
  identityKeySet: Config.map(Config.option(Config.String('IDENTITY_JWKS')), Option.getOrUndefined),
  identityKeySetUrl: Config.map(Config.option(Config.String('IDENTITY_JWKS_URL')), Option.getOrUndefined),
});

type Given = typeof settingsGiven extends Config.Config<infer A> ? A : never;

interface Complete extends Given {
  readonly issuer: string;
  readonly clientId: string;
  readonly secret: Redacted.Redacted | string;
}

const together =
  'OIDC_ISSUER: Set OIDC_ISSUER and OIDC_CLIENT_ID together with OIDC_CLIENT_SECRET or OIDC_CLIENT_SECRET_FILE';

const secretGivenTwice = 'OIDC_CLIENT_SECRET: Set one of OIDC_CLIENT_SECRET and OIDC_CLIENT_SECRET_FILE, not more';

const inLocalMode =
  'ACCESS_MODE: local takes no OIDC_ISSUER, since in local mode every request acts as the local developer; set one or the other';

const withoutAnAddress =
  'OIDC_ISSUER: needs PUBLIC_URL, the URL at which people reach the runtime, since the redirect URI is under it';

const withoutOpenId = 'OIDC_SCOPES: must include openid';

const requiredClaimWithoutAnIssuer =
  'OIDC_REQUIRED_CLAIM: needs OIDC_ISSUER, the identity provider whose ID Tokens carry the claim';

function scopesIn(text: string): readonly string[] {
  return text.split(' ').filter((scope) => scope !== '');
}

function isAnyGiven({ issuer, clientId, clientSecret, clientSecretFile }: Given): boolean {
  return [issuer, clientId, clientSecret, clientSecretFile].some((value) => value !== undefined);
}

function completeOf(read: Given): Complete | undefined {
  const { issuer, clientId, clientSecret, clientSecretFile } = read;
  const secret = clientSecret ?? clientSecretFile;
  return issuer === undefined || clientId === undefined || secret === undefined
    ? undefined
    : { ...read, issuer, clientId, secret };
}

function identityServiceRefusalOf({ identityIssuer, identityKeySet, identityKeySetUrl }: Given): string | undefined {
  const named: readonly (readonly [string, string | undefined])[] = [
    ['IDENTITY_ISSUER', identityIssuer],
    ['IDENTITY_JWKS', identityKeySet],
    ['IDENTITY_JWKS_URL', identityKeySetUrl],
  ];
  const [setting] = named.find(([, value]) => value !== undefined) ?? [];
  return setting === undefined ? undefined : `OIDC_ISSUER: Set one of OIDC_ISSUER and ${setting}, not more`;
}

function refusalOf(read: Complete, accessMode: OpenIdConnectDeciding['accessMode']): string | undefined {
  const refusals: readonly (string | undefined)[] = [
    read.clientSecret !== undefined && read.clientSecretFile !== undefined ? secretGivenTwice : undefined,
    identityServiceRefusalOf(read),
    accessMode === 'local' ? inLocalMode : undefined,
    scopesIn(read.scopes).includes('openid') ? undefined : withoutOpenId,
  ];
  return refusals.find((refusal) => refusal !== undefined);
}

function readableByTheServer(file: string): boolean {
  try {
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function refusedFile(file: string, detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `OIDC_CLIENT_SECRET_FILE: The file ${resolve(file)} ${detail}` });
}

function secretIn(file: string): Redacted.Redacted {
  if (!existsSync(file)) {
    throw refusedFile(file, 'does not exist');
  }
  if (!readableByTheServer(file)) {
    throw refusedFile(file, 'cannot be read by the user the server runs as');
  }
  const secret = readFileSync(file, 'utf8').replace(/[\r\n]+$/u, '');
  if (secret === '') {
    throw refusedFile(file, 'is empty');
  }
  return Redacted.make(secret);
}

function settingsOf(read: Complete, publicUrl: string): OpenIdConnectSettings {
  const { issuer, clientId, secret, scopes, tokenEndpointAuthMethod, requiredClaim } = read;
  return {
    issuer,
    clientId,
    clientSecret: typeof secret === 'string' ? secretIn(secret) : secret,
    scopes: scopesIn(scopes),
    tokenEndpointAuthMethod,
    publicUrl,
    redirectUri: `${publicUrl}${callbackPath}`,
    requiredClaim: requiredClaimOf(requiredClaim),
  };
}

export function readOpenIdConnectSettings(
  environment: Environment,
  deciding: OpenIdConnectDeciding,
): OpenIdConnectSettings | undefined {
  const read = Effect.runSync(asInvalidSettings(settingsGiven.parse(ConfigProvider.fromEnvRecord(environment))));
  if (read.requiredClaim !== undefined && read.issuer === undefined) {
    throw new InvalidSettingsError({ message: requiredClaimWithoutAnIssuer });
  }
  if (!isAnyGiven(read)) {
    return undefined;
  }
  const complete = completeOf(read);
  const refusal = complete === undefined ? together : refusalOf(complete, deciding.accessMode);
  if (refusal !== undefined || complete === undefined) {
    throw new InvalidSettingsError({ message: String(refusal) });
  }
  if (deciding.publicUrl === undefined) {
    throw new InvalidSettingsError({ message: withoutAnAddress });
  }
  return settingsOf(complete, deciding.publicUrl);
}
