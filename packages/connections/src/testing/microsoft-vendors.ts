import type { VendorOfTheWay } from './vendor-fakes.ts';

const microsoft = 'https://login.microsoftonline.com';

const workIqServer = 'https://workiq.svc.cloud.microsoft';

function microsoftEndpointsAt(tenant: string) {
  return {
    authorization: `${microsoft}/${tenant}/oauth2/v2.0/authorize`,
    token: `${microsoft}/${tenant}/oauth2/v2.0/token`,
  };
}

export const microsoftAdvertising: VendorOfTheWay = {
  metadata: { issuer: `${microsoft}/common/v2.0` },
  endpointsAt: microsoftEndpointsAt('common'),
  resource: null,
};

export const microsoftGraph: VendorOfTheWay = {
  metadata: { issuer: `${microsoft}/organizations/v2.0` },
  endpointsAt: microsoftEndpointsAt('organizations'),
  resource: null,
};

export const workIq: VendorOfTheWay = {
  metadata: {
    issuer: `${microsoft}/organizations/v2.0`,
    authorizationServers: [`${microsoft}/organizations/v2.0`],
    protectedResource: `${workIqServer}/mcp`,
    protectedScopes: ['fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask'],
  },
  protectedResourceAt: `${workIqServer}/.well-known/oauth-protected-resource/mcp`,
  endpointsAt: microsoftEndpointsAt('organizations'),
  resource: `${workIqServer}/mcp`,
};
