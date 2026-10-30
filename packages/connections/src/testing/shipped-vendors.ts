import { googleApi } from './google-vendors.ts';
import { microsoftAdvertising, microsoftGraph, workIq } from './microsoft-vendors.ts';
import type { VendorOfTheWay } from './vendor-fakes.ts';

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

const stripeMcp = 'https://mcp.stripe.com';

const stripeAccess = 'https://access.stripe.com/mcp';

const atlassianMcp = 'https://mcp.atlassian.com';

const atlassianAuth = 'https://auth.atlassian.com';

const atlassianMcpServerPath = 'VCeDsk8ZHncYF1g234fKtc4lNipbBhu3';

const atlassianIssuer = `${atlassianAuth}/${atlassianMcpServerPath}`;

const hubspotMcp = 'https://mcp.hubspot.com';

const bufferMcp = 'https://mcp.buffer.com/mcp';

const bufferAuth = 'https://auth.buffer.com';

const linkedInIssuer = 'https://www.linkedin.com/oauth';

const sixtyDays = 5_184_000;

const bufferScopes = [
  'posts:read',
  'posts:write',
  'ideas:read',
  'ideas:write',
  'account:read',
  'account:write',
  'insights:read',
  'engagements:read',
  'engagements:write',
  'snippets:read',
  'snippets:write',
  'channels:write',
];

function registeringServerAt(server: string, issuer: string): VendorOfTheWay {
  const { origin, pathname } = new URL(server);
  const resource = `${origin}${pathname}`;
  return {
    metadata: {
      issuer,
      authorizationServers: [issuer],
      protectedResource: resource,
      dynamicRegistration: true,
      clientMetadataDocuments: true,
    },
    challengedAt: server,
    protectedResourceAt: `${origin}/.well-known/oauth-protected-resource${pathname}`,
    authorizationServerAt: `${issuer}/.well-known/oauth-authorization-server`,
    resource,
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
      authorizationServers: [adobeMcp],
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
      authorizationServers: [loginWithAmazon],
      protectedResource: amazonAdsMcp,
      protectedScopes: ['advertising::campaign_management'],
      scopesSupported: ['profile'],
    },
    protectedResourceAt: `${amazonAdsMcp}/.well-known/oauth-protected-resource`,
    authorizationServerAt: `${loginWithAmazon}/.well-known/oauth-authorization-server`,
    resource: amazonAdsMcp,
  },
  atlassian: {
    metadata: {
      issuer: atlassianIssuer,
      authorizationServers: [atlassianIssuer],
      protectedResource: `${atlassianMcp}/v2/mcp`,
      dynamicRegistration: true,
      clientMetadataDocuments: true,
    },
    challengedAt: `${atlassianMcp}/v2/mcp?tools=all`,
    protectedResourceAt: `${atlassianMcp}/.well-known/oauth-protected-resource/v2/mcp`,
    authorizationServerAt: `${atlassianAuth}/.well-known/oauth-authorization-server/${atlassianMcpServerPath}`,
    resource: `${atlassianMcp}/v2/mcp`,
  },
  buffer: {
    metadata: {
      issuer: bufferAuth,
      authorizationServers: [bufferAuth],
      protectedResource: bufferMcp,
      protectedScopes: bufferScopes,
      scopesSupported: ['offline_access', ...bufferScopes],
      dynamicRegistration: true,
      clientSecret: undefined,
      takesPublicClientsAlone: true,
    },
    challengedAt: bufferMcp,
    protectedResourceAt: 'https://mcp.buffer.com/.well-known/oauth-protected-resource/mcp',
    authorizationServerAt: `${bufferAuth}/.well-known/oauth-authorization-server`,
    resource: bufferMcp,
    asked: 'posts:read ideas:read account:read insights:read posts:write ideas:write offline_access',
  },
  'campaign-manager-360': googleApi,
  'display-video-360': googleApi,
  'display-video-360-reports': googleApi,
  github: {
    metadata: {
      issuer: 'https://github.com/login/oauth',
      authorizationServers: ['https://github.com/login/oauth'],
      protectedResource: 'https://api.githubcopilot.com/mcp',
      scopesSupported: ['offline_access'],
    },
    protectedResourceAt: 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp',
    authorizationServerAt: 'https://github.com/.well-known/oauth-authorization-server/login/oauth',
    resource: 'https://api.githubcopilot.com/mcp',
    asked: 'read:org repo offline_access',
  },
  gmail: googleApi,
  'google-ads': googleApi,
  'google-analytics': googleApi,
  'google-analytics-admin': googleApi,
  'google-docs': googleApi,
  'google-drive': googleApi,
  'google-search-console': googleApi,
  'google-sheets': googleApi,
  'google-slides': googleApi,
  hubspot: {
    metadata: {
      issuer: hubspotMcp,
      authorizationServers: [hubspotMcp],
      protectedResource: hubspotMcp,
      takesBasicSecrets: false,
    },
    protectedResourceAt: `${hubspotMcp}/.well-known/oauth-protected-resource`,
    authorizationServerAt: `${hubspotMcp}/.well-known/oauth-authorization-server`,
    resource: hubspotMcp,
  },
  linear: registeringServerAt('https://mcp.linear.app/mcp', 'https://mcp.linear.app'),
  linkedin: {
    metadata: {
      issuer: linkedInIssuer,
      takesNoChallenge: true,
      issuesRefreshTokens: false,
      expiresInSeconds: sixtyDays,
      namesTokenType: false,
    },
    endpointsAt: {
      authorization: 'https://www.linkedin.com/oauth/v2/authorization',
      token: 'https://www.linkedin.com/oauth/v2/accessToken',
    },
    resource: null,
  },
  'microsoft-advertising': microsoftAdvertising,
  'microsoft-teams': microsoftGraph,
  notion: registeringServerAt('https://mcp.notion.com/mcp', 'https://mcp.notion.com'),
  onedrive: microsoftGraph,
  outlook: microsoftGraph,
  posthog: registeringServerAt('https://mcp.posthog.com/mcp?mode=tools', 'https://oauth.posthog.com'),
  profound: {
    metadata: {
      issuer: 'https://auth.tryprofound.com',
      authorizationServers: ['https://auth.tryprofound.com/'],
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
      authorizationServers: ['https://mcp.slack.com'],
      protectedResource: 'https://mcp.slack.com',
      takesBasicSecrets: false,
    },
    protectedResourceAt: 'https://mcp.slack.com/.well-known/oauth-protected-resource',
    authorizationServerAt: 'https://mcp.slack.com/.well-known/oauth-authorization-server',
    resource: 'https://mcp.slack.com',
  },
  stripe: {
    metadata: {
      issuer: stripeAccess,
      authorizationServers: [stripeAccess],
      protectedResource: stripeMcp,
      protectedScopes: ['mcp'],
      scopesSupported: ['mcp'],
      dynamicRegistration: true,
      clientSecret: undefined,
      takesPublicClientsAlone: true,
      listsRevocationMethods: false,
    },
    protectedResourceAt: `${stripeMcp}/.well-known/oauth-protected-resource`,
    authorizationServerAt: 'https://access.stripe.com/.well-known/oauth-authorization-server/mcp',
    resource: stripeMcp,
  },
  'work-iq': workIq,
  youtube: googleApi,
  'youtube-analytics': googleApi,
  'youtube-management': googleApi,
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
