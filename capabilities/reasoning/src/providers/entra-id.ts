import { Effect, Predicate } from 'effect';

import type { AzureSettings } from '../settings/provider-settings.ts';
import type { Availability } from '../settings/setting-values.ts';
import type { AccessTokenSource } from './credential-sources.ts';

export interface AccessToken {
  readonly token: string;
  readonly expiresOnTimestamp: number;
}

interface TokenCredential {
  getToken(scopes: string | readonly string[]): Promise<AccessToken | null>;
}

export interface EntraIdentity {
  readonly defaultCredential: () => TokenCredential;
  readonly bearerTokens: (credential: TokenCredential, scope: string) => AccessTokenSource;
}

export type EntraIdentityLoader = () => Promise<EntraIdentity | null>;

export const entraIdVariables: readonly string[] = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_CLIENT_CERTIFICATE_PASSWORD',
  'AZURE_CLIENT_SEND_CERTIFICATE_CHAIN',
  'AZURE_USERNAME',
  'AZURE_PASSWORD',
  'AZURE_ADDITIONALLY_ALLOWED_TENANTS',
  'AZURE_FEDERATED_TOKEN_FILE',
];

export const cognitiveServicesScope = 'https://cognitiveservices.azure.com/.default';

export function isMissingModule(error: unknown): boolean {
  return Predicate.hasProperty(error, 'code') && error.code === 'ERR_MODULE_NOT_FOUND';
}

export async function importUnlessMissing<Module>(load: () => Promise<Module>): Promise<Module | undefined> {
  try {
    return await load();
  } catch (error) {
    if (isMissingModule(error)) {
      return undefined;
    }
    throw error;
  }
}

export interface IdentityLibrary {
  readonly DefaultAzureCredential: new () => TokenCredential;
  readonly getBearerTokenProvider: (credential: TokenCredential, scope: string) => AccessTokenSource;
}

export function entraIdentityOf(library: IdentityLibrary): EntraIdentity {
  return {
    defaultCredential: () => new library.DefaultAzureCredential(),
    bearerTokens: (credential, scope) => library.getBearerTokenProvider(credential, scope),
  };
}

export function entraIdentityLoader(load: () => Promise<IdentityLibrary>): EntraIdentityLoader {
  return async () => {
    const library = await importUnlessMissing(load);
    return library === undefined ? null : entraIdentityOf(library);
  };
}

export const noEntraIdentity: EntraIdentityLoader = () => Promise.resolve(null);

export function entraTokens(identity: EntraIdentity): AccessTokenSource {
  return identity.bearerTokens(identity.defaultCredential(), cognitiveServicesScope);
}

export const azureTokensFor = Effect.fnUntraced(function* (
  azure: Availability<AzureSettings>,
  override: AccessTokenSource | undefined,
  load: EntraIdentityLoader,
) {
  const needsEntraId = azure.configured && azure.settings.api_key === null;
  if (!needsEntraId || override !== undefined) {
    return override;
  }
  const identity = yield* Effect.promise(load);
  return identity === null ? undefined : entraTokens(identity);
});
