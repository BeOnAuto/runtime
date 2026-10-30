import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  hostAlternativesOf,
  readProviders,
  type CredentialWay,
  type ProviderEntry,
  providersShippedRoots,
} from '../index.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const google = 'accounts.google.com';

const microsoft = 'login.microsoftonline.com';

const amazon = 'lwa.amazon.com';

const hostsOfTheWays = [
  [[['analytics.adobe.io', 'ims-na1.adobelogin.com']], [['analytics.adobe.io', 'ims-na1.adobelogin.com']]],
  [[['aa-mcp.adobe.io', 'aa-mcp.adobe.io']]],
  [
    [
      ['advertising-api.amazon.com', amazon, 'www.amazon.com', 'api.amazon.com'],
      ['advertising-api-eu.amazon.com', amazon, 'eu.account.amazon.com', 'api.amazon.co.uk'],
      ['advertising-api-fe.amazon.com', amazon, 'apac.account.amazon.com', 'api.amazon.co.jp'],
    ],
  ],
  [
    [
      ['advertising-ai.amazon.com', amazon],
      ['advertising-ai-eu.amazon.com', amazon],
      ['advertising-ai-fe.amazon.com', amazon],
    ],
  ],
  [[['mcp.atlassian.com', 'auth.atlassian.com']]],
  [[['mcp.buffer.com']]],
  [[['dfareporting.googleapis.com', google]]],
  [[['displayvideo.googleapis.com', google]]],
  [[['doubleclickbidmanager.googleapis.com', google]]],
  [[['api.githubcopilot.com', 'github.com']], [['api.githubcopilot.com']]],
  [[['gmail.googleapis.com', google]]],
  [[['googleads.googleapis.com', google]]],
  [[['analyticsdata.googleapis.com', google]]],
  [[['analyticsadmin.googleapis.com', google]]],
  [[['docs.googleapis.com', google]]],
  [[['www.googleapis.com', google]]],
  [[['searchconsole.googleapis.com', google]]],
  [[['sheets.googleapis.com', google]]],
  [[['slides.googleapis.com', google]]],
  [[['mcp.hubspot.com', 'mcp.hubspot.com']]],
  [[['mcp.linear.app', 'mcp.linear.app']]],
  [[['api.linkedin.com', 'www.linkedin.com', 'www.linkedin.com', 'www.linkedin.com']]],
  [[['partner.api.bingads.microsoft.com', microsoft, microsoft, microsoft]]],
  [[['graph.microsoft.com', microsoft, microsoft, microsoft]]],
  [[['mcp.notion.com', 'mcp.notion.com']]],
  [[['graph.microsoft.com', microsoft, microsoft, microsoft]]],
  [[['graph.microsoft.com', microsoft, microsoft, microsoft]]],
  [[['mcp.posthog.com', 'oauth.posthog.com']]],
  [[['mcp.tryprofound.com', 'auth.tryprofound.com']], [['mcp.tryprofound.com']]],
  [[['searchads360.googleapis.com', google]]],
  [[['mcp.slack.com', 'mcp.slack.com']]],
  [[['slack.com']]],
  [[['mcp.stripe.com', 'access.stripe.com']]],
  [[['workiq.svc.cloud.microsoft', microsoft, microsoft, microsoft]]],
  [[['api.x.com', 'api.x.com', 'x.com', 'api.x.com', 'api.x.com']]],
  [[['youtube.googleapis.com', google]]],
  [[['youtubeanalytics.googleapis.com', google]]],
  [[['youtube.googleapis.com', google]]],
  [[['api.zoom.us', 'zoom.us', 'zoom.us', 'zoom.us', 'zoom.us']]],
];

const microsoftAmazonAndAdobe: ReadonlySet<string> = new Set([
  'adobe-analytics',
  'adobe-analytics-mcp',
  'amazon-ads',
  'amazon-ads-mcp',
  'microsoft-advertising',
  'microsoft-teams',
  'onedrive',
  'outlook',
  'work-iq',
]);

const adobe = 'openid AdobeID read_organizations additional_info.projectedProductContext';

function forWorkAccounts(scopes: string) {
  return {
    issuer: 'https://login.microsoftonline.com/organizations/v2.0',
    authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    scope: `${scopes} offline_access`,
    clients: ['registered'],
  };
}

const consentWays = [
  [
    'adobe-analytics',
    {
      issuer: 'https://ims-na1.adobelogin.com',
      scope: `${adobe} additional_info.job_function offline_access`,
      clients: ['registered'],
    },
  ],
  [
    'adobe-analytics-mcp',
    {
      issuer: 'https://aa-mcp.adobe.io',
      scope: 'openid AdobeID additional_info.projectedProductContext',
      clients: ['registered', 'dynamic'],
    },
  ],
  [
    'amazon-ads',
    {
      issuer: 'https://lwa.amazon.com',
      authorization_endpoint: 'https://{sign_in_host}/ap/oa',
      token_endpoint: 'https://{token_host}/auth/o2/token',
      scope: 'advertising::campaign_management',
      clients: ['registered'],
    },
  ],
  [
    'amazon-ads-mcp',
    { issuer: 'https://lwa.amazon.com', scope: 'advertising::campaign_management', clients: ['registered'] },
  ],
  [
    'microsoft-advertising',
    {
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      authorization_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      token_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scope: 'https://ads.microsoft.com/msads.manage offline_access',
      clients: ['registered'],
    },
  ],
  [
    'microsoft-teams',
    forWorkAccounts('Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send Chat.Read ChatMessage.Send'),
  ],
  ['onedrive', forWorkAccounts('Files.ReadWrite.All Sites.Read.All')],
  ['outlook', forWorkAccounts('Mail.ReadWrite Mail.Send Calendars.ReadWrite User.Read')],
  ['work-iq', forWorkAccounts('fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask')],
];

const kindAndProse: ReadonlySet<string> = new Set(['kind', 'description', 'says', 'more']);

function fieldsOfConsent(way: CredentialWay): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(way).filter(([field]: readonly [string, unknown]) => !kindAndProse.has(field)),
  );
}

function consentOf({ name, credentials }: ProviderEntry) {
  return credentials.filter(({ kind }) => kind === 'authorization').map((way) => [name, fieldsOfConsent(way)]);
}

function signsInAtGoogle({ credentials }: ProviderEntry): boolean {
  return credentials.some(({ issuer }) => issuer === `https://${google}`);
}

function namedAtGoogle(scope: string): string {
  return scope.replaceAll('https://www.googleapis.com/auth/', '');
}

function scopesOfEachWayAtGoogle({ name, credentials }: ProviderEntry) {
  return [name, credentials.map(({ scope = '' }) => namedAtGoogle(scope))];
}

function moreOfEachWayAtGoogle({ name, credentials }: ProviderEntry) {
  return credentials.flatMap(({ more = [] }) =>
    more.map((group) => [name, group.name, group.for, namedAtGoogle(group.scope)]),
  );
}

function headersOf({ name, headers }: ProviderEntry) {
  return headers === undefined ? [] : [[name, headers]];
}

describe('the hosts the ways of the shipped providers reach', () => {
  it('are those of their servers, their issuers and the endpoints they name, for each region where a region sets them', () => {
    expect(
      shipped.providers.map((provider) => provider.entry.credentials.map((way) => hostAlternativesOf(provider, way))),
    ).toEqual(hostsOfTheWays);
  });
});

describe('the ways of consent of the shipped providers of Microsoft, Amazon and Adobe', () => {
  it('name the issuer, the endpoints where its server publishes none for them, the scope and the client sources', () => {
    const consenting = shipped.providers.filter(({ entry }) => microsoftAmazonAndAdobe.has(entry.name));

    expect(consenting.flatMap(({ entry }) => consentOf(entry))).toEqual(consentWays);
  });
});

describe('the ways of consent of the shipped providers of Google', () => {
  it('ask the scopes their tools need, google-drive reading every file and writing those Auto creates', () => {
    const consenting = shipped.providers.filter(({ entry }) => signsInAtGoogle(entry));

    expect(consenting.map(({ entry }) => scopesOfEachWayAtGoogle(entry))).toEqual([
      ['campaign-manager-360', ['dfareporting dfatrafficking']],
      ['display-video-360', ['display-video']],
      ['display-video-360-reports', ['doubleclickbidmanager']],
      ['gmail', ['gmail.readonly']],
      ['google-ads', ['adwords']],
      ['google-analytics', ['analytics.readonly']],
      ['google-analytics-admin', ['analytics.readonly']],
      ['google-docs', ['documents.readonly documents']],
      ['google-drive', ['drive.readonly drive.file']],
      ['google-search-console', ['webmasters']],
      ['google-sheets', ['spreadsheets.readonly spreadsheets']],
      ['google-slides', ['presentations.readonly presentations']],
      ['search-ads-360', ['doubleclicksearch']],
      ['youtube', ['youtube.readonly']],
      ['youtube-analytics', ['yt-analytics.readonly yt-analytics-monetary.readonly']],
      ['youtube-management', ['youtube.force-ssl']],
    ]);
  });

  it('name what a later consent may add on google-drive alone', () => {
    const consenting = shipped.providers.filter(({ entry }) => signsInAtGoogle(entry));

    expect(consenting.flatMap(({ entry }) => moreOfEachWayAtGoogle(entry))).toEqual([
      ['google-drive', 'edit', 'Change and delete files you already have.', 'drive'],
    ]);
  });
});

describe('the headers of the shipped providers', () => {
  it('are those their vendors ask for, with the client id of the connection where a vendor asks for it', () => {
    expect(shipped.providers.flatMap(({ entry }) => headersOf(entry))).toEqual([
      ['adobe-analytics', { 'x-api-key': '{client_id}' }],
      ['amazon-ads', { 'Amazon-Ads-ClientId': '{client_id}', 'Amazon-Ads-AccountId': '{account_id}' }],
      ['amazon-ads-mcp', { 'Amazon-Ads-ClientId': '{client_id}' }],
      ['github', { 'X-MCP-Toolsets': 'context,repos,issues,pull_requests,users' }],
      ['google-ads', { 'login-customer-id': '{manager_id}' }],
      ['linkedin', { 'LinkedIn-Version': '202610', 'X-Restli-Protocol-Version': '2.0.0' }],
      ['search-ads-360', { 'login-customer-id': '{manager_id}' }],
    ]);
  });
});
