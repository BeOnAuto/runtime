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

const zoomScopes = [
  'user:read:user',
  'meeting:read:list_meetings',
  'meeting:read:meeting',
  'meeting:read:past_meeting',
  'meeting:read:list_past_participants',
  'cloud_recording:read:list_user_recordings',
  'cloud_recording:read:list_recording_files',
  'cloud_recording:read:meeting_transcript',
  'meeting:read:summary',
  'team_chat:read:list_user_channels',
  'team_chat:read:list_user_messages',
  'team_chat:read:thread_message',
  'meeting:write:meeting',
  'meeting:update:meeting',
  'team_chat:write:user_message',
];

const adobeIms = 'https://ims-na1.adobelogin.com';

const adobeMcp = 'https://aa-mcp.adobe.io';

const adobeMcpScopes = ['openid', 'AdobeID', 'additional_info.projectedProductContext'];

const loginWithAmazon = 'https://lwa.amazon.com';

const amazonAdsMcp = 'https://advertising-ai.amazon.com';

const microsoft = 'https://login.microsoftonline.com';

const workIq = 'https://workiq.svc.cloud.microsoft';

function microsoftEndpointsAt(tenant: string) {
  return {
    authorization: `${microsoft}/${tenant}/oauth2/v2.0/authorize`,
    token: `${microsoft}/${tenant}/oauth2/v2.0/token`,
  };
}

export const vendorsOfTheShippedWays: Readonly<Record<string, VendorOfTheWay>> = {
  'adobe-analytics': {
    metadata: {
      issuer: adobeIms,
      scopesSupported: ['openid', 'email', 'profile'],
      challengeMethods: ['S256', 'plain'],
    },
    authorizationServerAt: `${adobeIms}/.well-known/oauth-authorization-server`,
    resource: null,
  },
  'adobe-analytics-mcp': {
    metadata: {
      issuer: adobeMcp,
      authorizationServer: adobeMcp,
      protectedResource: `${adobeMcp}/mcp`,
      protectedScopes: adobeMcpScopes,
      scopesSupported: adobeMcpScopes,
      dynamicRegistration: true,
    },
    protectedResourceAt: `${adobeMcp}/.well-known/oauth-protected-resource/mcp`,
    authorizationServerAt: `${adobeMcp}/.well-known/oauth-authorization-server`,
    resource: `${adobeMcp}/mcp`,
  },
  'amazon-ads': {
    metadata: { issuer: loginWithAmazon },
    endpointsAt: { authorization: 'https://www.amazon.com/ap/oa', token: 'https://api.amazon.com/auth/o2/token' },
    resource: null,
  },
  'amazon-ads-mcp': {
    metadata: {
      issuer: loginWithAmazon,
      authorizationServer: loginWithAmazon,
      protectedResource: amazonAdsMcp,
      protectedScopes: ['advertising::campaign_management'],
      scopesSupported: ['profile'],
    },
    protectedResourceAt: `${amazonAdsMcp}/.well-known/oauth-protected-resource`,
    authorizationServerAt: `${loginWithAmazon}/.well-known/oauth-authorization-server`,
    resource: amazonAdsMcp,
  },
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
  'microsoft-advertising': {
    metadata: { issuer: `${microsoft}/common/v2.0` },
    endpointsAt: microsoftEndpointsAt('common'),
    resource: null,
  },
  outlook: {
    metadata: {
      issuer: `${microsoft}/organizations/v2.0`,
      authorizationServer: `${microsoft}/organizations/v2.0`,
      protectedResource: `${workIq}/mcp`,
      protectedScopes: ['fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask'],
    },
    protectedResourceAt: `${workIq}/.well-known/oauth-protected-resource/mcp`,
    endpointsAt: microsoftEndpointsAt('organizations'),
    resource: `${workIq}/mcp`,
  },
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
  zoom: {
    metadata: { issuer: 'https://zoom.us', grantedScope: zoomScopes.join(' ') },
    authorizationServerAt: 'https://zoom.us/.well-known/oauth-authorization-server',
    endpointsAt: {
      authorization: 'https://zoom.us/oauth/authorize',
      token: 'https://zoom.us/oauth/token',
      revocation: 'https://zoom.us/oauth/revoke',
    },
    resource: null,
  },
};
