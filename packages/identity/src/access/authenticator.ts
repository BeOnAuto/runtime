import type { IdentityService, ProtectedResource } from '../identity-service/identity-service.ts';
import { configuredApiKeys, type ApiKeySource } from '../keys/api-key-source.ts';
import { keyPrefix, type ApiKey } from '../keys/api-key.ts';
import { verifyKey } from '../keys/verify-key.ts';
import { accessModeOf, type AccessMode, type DeclaredAccessMode } from './access-mode.ts';
import { localDeveloper, principalOf, unexplained, type Authentication } from './principal.ts';
import { ReachableWithoutCredentialsError } from './reachable-without-credentials-error.ts';

export interface Authenticator {
  readonly mode: AccessMode;
  readonly resource: ProtectedResource | undefined;
  readonly authenticate: (
    presented: string | undefined,
    resourcePath: string,
    requestOrigin?: string,
  ) => Promise<Authentication>;
}

export interface AccessSettings {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly apiKeySource?: ApiKeySource | undefined;
  readonly identityService?: IdentityService | undefined;
  readonly accessMode?: DeclaredAccessMode | undefined;
}

async function keyHolderOf(source: ApiKeySource, presented: string | undefined): Promise<Authentication> {
  const key = presented === undefined ? undefined : await verifyKey(source, presented);
  return key === undefined ? unexplained : principalOf(key);
}

function credentialHolderOf(source: ApiKeySource, identityService?: IdentityService): Authenticator['authenticate'] {
  return (presented, resourcePath, requestOrigin) =>
    presented !== undefined && identityService !== undefined && !presented.startsWith(keyPrefix)
      ? identityService.personOf(presented, resourcePath, requestOrigin)
      : keyHolderOf(source, presented);
}

const localAccess: Authenticator = {
  mode: 'local',
  resource: undefined,
  authenticate: () => Promise.resolve(localDeveloper),
};

const closedAccess: Authenticator = {
  mode: 'closed',
  resource: undefined,
  authenticate: credentialHolderOf(configuredApiKeys([])),
};

function credentialAccessOf(source: ApiKeySource, identityService: IdentityService | undefined): Authenticator {
  return {
    mode: 'credentials',
    resource: identityService?.resource,
    authenticate: credentialHolderOf(source, identityService),
  };
}

function accessOf(mode: AccessMode, { apiKeys, apiKeySource, identityService }: AccessSettings): Authenticator {
  if (mode === 'local') {
    return localAccess;
  }
  return mode === 'closed'
    ? closedAccess
    : credentialAccessOf(apiKeySource ?? configuredApiKeys(apiKeys), identityService);
}

export function authenticatorFor(settings: AccessSettings): Authenticator {
  const { host, apiKeys, identityService, accessMode } = settings;
  const mode = accessModeOf({ host, apiKeys, signsIn: identityService !== undefined, accessMode });
  if (mode === undefined) {
    throw new ReachableWithoutCredentialsError({
      message: `A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST ${host}; where only this computer reaches its port, ACCESS_MODE=local with a PUBLIC_URL on the loopback declares local mode instead`,
    });
  }
  return accessOf(mode, settings);
}
