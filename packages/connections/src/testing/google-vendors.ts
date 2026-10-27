import type { VendorOfTheWay } from './vendor-fakes.ts';

const google = 'https://accounts.google.com';

const googleScope = 'https://www.googleapis.com/auth/';

const googleChallenges = ['plain', 'S256'];

const offlineWithConsent = { access_type: 'offline', prompt: 'consent' };

function inFull(scope: string): string {
  return scope.startsWith('https://') ? scope : `${googleScope}${scope}`;
}

export function workspaceServerAt(host: string, scopes: readonly string[]): VendorOfTheWay {
  const resource = `https://${host}/mcp/v1`;
  return {
    metadata: {
      issuer: google,
      authorizationServers: [`${google}/`],
      protectedResource: resource,
      protectedScopes: scopes.map((scope) => inFull(scope)),
      challengeMethods: googleChallenges,
    },
    protectedResourceAt: `https://${host}/.well-known/oauth-protected-resource/mcp/v1`,
    authorizationServerAt: `${google}/.well-known/oauth-authorization-server`,
    resource,
    parameters: offlineWithConsent,
  };
}

export const googleApi: VendorOfTheWay = {
  metadata: {
    issuer: google,
    openIdConnect: true,
    scopesSupported: ['openid', 'email', 'profile'],
    challengeMethods: googleChallenges,
  },
  openIdConfigurationAt: `${google}/.well-known/openid-configuration`,
  resource: null,
  parameters: offlineWithConsent,
};
