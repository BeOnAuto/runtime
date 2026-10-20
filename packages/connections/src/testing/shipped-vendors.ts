import type { Vendor } from './vendor-fakes.ts';

export interface VendorOfTheWay extends Vendor {
  readonly resource: string | null;
  readonly asked?: string;
  readonly parameters?: Readonly<Record<string, string>>;
}

const google = 'https://accounts.google.com';

const googleScope = 'https://www.googleapis.com/auth/';

const googleChallenges = ['plain', 'S256'];

const offlineWithConsent = { access_type: 'offline', prompt: 'consent' };

function inFull(scope: string): string {
  return scope.startsWith('https://') ? scope : `${googleScope}${scope}`;
}

function workspaceServerAt(host: string, scopes: readonly string[]): VendorOfTheWay {
  const resource = `https://${host}/mcp/v1`;
  return {
    metadata: {
      issuer: google,
      authorizationServer: `${google}/`,
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

const googleApi: VendorOfTheWay = {
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

export const vendorsOfTheShippedWays: Readonly<Record<string, VendorOfTheWay>> = {
  'campaign-manager-360': googleApi,
  'display-video-360': googleApi,
  'display-video-360-reports': googleApi,
  github: {
    metadata: {
      issuer: 'https://github.com/login/oauth',
      authorizationServer: 'https://github.com/login/oauth',
      protectedResource: 'https://api.githubcopilot.com/mcp',
      scopesSupported: ['offline_access'],
    },
    protectedResourceAt: 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp',
    authorizationServerAt: 'https://github.com/.well-known/oauth-authorization-server/login/oauth',
    resource: 'https://api.githubcopilot.com/mcp',
    asked: 'read:org repo offline_access',
  },
  gmail: workspaceServerAt('gmailmcp.googleapis.com', [
    'https://mail.google.com/',
    'gmail.compose',
    'gmail.drafts',
    'gmail.drafts.create',
    'gmail.drafts.readonly',
    'gmail.labels',
    'gmail.metadata',
    'gmail.modify',
    'gmail.readonly',
    'gmail.send',
    'gmail.settings.basic',
  ]),
  'google-ads': googleApi,
  'google-analytics': googleApi,
  'google-analytics-admin': googleApi,
  'google-docs': workspaceServerAt('docsmcp.googleapis.com', [
    'drive.readonly',
    'documents.readonly',
    'drive',
    'documents',
  ]),
  'google-drive': workspaceServerAt('drivemcp.googleapis.com', ['drive', 'drive.readonly', 'drive.file']),
  'google-search-console': googleApi,
  'google-sheets': workspaceServerAt('sheetsmcp.googleapis.com', [
    'drive.readonly',
    'spreadsheets.readonly',
    'drive',
    'spreadsheets',
  ]),
  'google-slides': workspaceServerAt('slidesmcp.googleapis.com', [
    'drive.readonly',
    'presentations.readonly',
    'drive',
    'drive.file',
    'presentations',
  ]),
  profound: {
    metadata: {
      issuer: 'https://auth.tryprofound.com',
      authorizationServer: 'https://auth.tryprofound.com/',
      protectedResource: 'https://mcp.tryprofound.com/mcp',
      scopesSupported: ['email', 'offline_access', 'openid', 'profile'],
      dynamicRegistration: true,
      clientMetadataDocuments: true,
    },
    protectedResourceAt: 'https://mcp.tryprofound.com/.well-known/oauth-protected-resource/mcp',
    authorizationServerAt: 'https://auth.tryprofound.com/.well-known/oauth-authorization-server',
    resource: 'https://mcp.tryprofound.com/mcp',
  },
  'search-ads-360': googleApi,
  slack: {
    metadata: {
      issuer: 'https://mcp.slack.com',
      authorizationServer: 'https://mcp.slack.com',
      protectedResource: 'https://mcp.slack.com',
      takesBasicSecrets: false,
    },
    protectedResourceAt: 'https://mcp.slack.com/.well-known/oauth-protected-resource',
    authorizationServerAt: 'https://mcp.slack.com/.well-known/oauth-authorization-server',
    resource: 'https://mcp.slack.com',
  },
};
