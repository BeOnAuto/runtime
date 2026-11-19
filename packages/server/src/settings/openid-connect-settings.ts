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

interface GivenClient {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
}

export interface OpenIdConnectSettings {
  readonly issuer: string;
  readonly client: GivenClient | undefined;
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
  readonly given: { readonly clientId: string; readonly secret: Redacted.Redacted | string } | undefined;
}

const together =
  'OIDC_ISSUER: Set OIDC_ISSUER and OIDC_CLIENT_ID together with OIDC_CLIENT_SECRET or OIDC_CLIENT_SECRET_FILE';

const halfAClient = (missing: string) =>
  `${missing}: Set OIDC_CLIENT_ID together with OIDC_CLIENT_SECRET or OIDC_CLIENT_SECRET_FILE, or leave them all out to let Auto register itself with the identity provider`;

const secretGivenTwice = 'OIDC_CLIENT_SECRET: Set one of OIDC_CLIENT_SECRET and OIDC_CLIENT_SECRET_FILE, not more';

const inLocalMode =
  'ACCESS_MODE: local takes no OIDC_ISSUER, since in local mode every request acts as the local developer; set one or the other';

const withoutAnAddress =
  'OIDC_ISSUER: needs PUBLIC_URL, the URL at which people reach the runtime, since the redirect URI is under it';

const withoutHttps =
  'OIDC_ISSUER: needs PUBLIC_URL to be an https URL, since the runtime then signs people in itself and keeps their sign-in in a cookie only https carries';

const withoutOpenId = 'OIDC_SCOPES: must include openid';

const requiredClaimWithoutAnIssuer =
  'OIDC_REQUIRED_CLAIM: needs OIDC_ISSUER, the identity provider whose ID Tokens carry the claim';

function scopesIn(text: string): readonly string[] {
  return text.split(' ').filter((scope) => scope !== '');
}

function isAnyGiven({ issuer, clientId, clientSecret, clientSecretFile }: Given): boolean {
  return [issuer, clientId, clientSecret, clientSecretFile].some((value) => value !== undefined);
}

function completeOf(read: Given, issuer: string): Complete {
  const { clientId, clientSecret, clientSecretFile } = read;
  const secret = clientSecret ?? clientSecretFile;
  if (clientId === undefined && secret === undefined) {
    return { ...read, issuer, given: undefined };
  }
  if (clientId === undefined || secret === undefined) {
    throw new InvalidSettingsError({
      message: halfAClient(clientId === undefined ? 'OIDC_CLIENT_ID' : 'OIDC_CLIENT_SECRET'),
    });
  }
  return { ...read, issuer, given: { clientId, secret } };
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

function clientOf(given: Complete['given']): GivenClient | undefined {
  return given === undefined
    ? undefined
    : {
        clientId: given.clientId,
        clientSecret: typeof given.secret === 'string' ? secretIn(given.secret) : given.secret,
      };
}

function settingsOf(read: Complete, publicUrl: string): OpenIdConnectSettings {
  const { issuer, given, scopes, tokenEndpointAuthMethod, requiredClaim } = read;
  return {
    issuer,
    client: clientOf(given),
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
  if (read.issuer === undefined) {
    throw new InvalidSettingsError({ message: together });
  }
  const complete = completeOf(read, read.issuer);
  const refusal = refusalOf(complete, deciding.accessMode);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  if (deciding.publicUrl === undefined) {
    throw new InvalidSettingsError({ message: withoutAnAddress });
  }
  if (!deciding.publicUrl.startsWith('https://')) {
    throw new InvalidSettingsError({ message: withoutHttps });
  }
  return settingsOf(complete, deciding.publicUrl);
}
