import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  accountTypesOf,
  accountTypeWhereNoneIsGiven,
  hostAlternativesOf,
  permissionsOf,
  providerNamed,
  readProviders,
  type CredentialWay,
  type ProviderEntry,
  providersShippedRoots,
} from '../index.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const google = 'accounts.google.com';

const sts = 'sts.googleapis.com';

const impersonation = 'iamcredentials.googleapis.com';

function keylessAt(host: string, signedIn: number): readonly (readonly (readonly string[])[])[] {
  const exchanged = [[host, sts, impersonation]];
  return [...Array.from({ length: signedIn }, () => [[host, google]]), exchanged, exchanged];
}

const microsoft = 'login.microsoftonline.com';

const amazon = 'lwa.amazon.com';

const hostsOfTheWays = [
  [[['analytics.adobe.io', 'ims-na1.adobelogin.com']], [['analytics.adobe.io', 'ims-na1.adobelogin.com']]],
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
  [[['{mcp_address}']]],
  [[['mcp.atlassian.com', 'auth.atlassian.com']], [['mcp.atlassian.com']]],
  [[['mcp.buffer.com']]],
  keylessAt('dfareporting.googleapis.com', 2),
  keylessAt('displayvideo.googleapis.com', 2),
  keylessAt('doubleclickbidmanager.googleapis.com', 1),
  [
    [['api.githubcopilot.com', 'github.com', 'github.com', 'github.com', 'api.github.com']],
    [['api.githubcopilot.com', 'github.com']],
    [['api.githubcopilot.com']],
    [['api.githubcopilot.com', 'api.github.com']],
  ],
  [[['gmail.googleapis.com', google]], [['gmail.googleapis.com', google]]],
  keylessAt('googleads.googleapis.com', 2),
  keylessAt('analyticsdata.googleapis.com', 2),
  keylessAt('analyticsadmin.googleapis.com', 2),
  keylessAt('docs.googleapis.com', 2),
  keylessAt('www.googleapis.com', 1),
  keylessAt('searchconsole.googleapis.com', 1),
  keylessAt('sheets.googleapis.com', 2),
  keylessAt('slides.googleapis.com', 2),
  [[['mcp.hubspot.com', 'mcp.hubspot.com']]],
  [[['mcp.linear.app', 'mcp.linear.app']]],
  [[['api.linkedin.com', 'www.linkedin.com', 'www.linkedin.com', 'www.linkedin.com']]],
  [[['partner.api.bingads.microsoft.com', microsoft, microsoft, microsoft]]],
  [[['graph.microsoft.com', microsoft, microsoft, microsoft]]],
  [[['mcp.notion.com', 'mcp.notion.com']]],
  [[['graph.microsoft.com', microsoft, microsoft, microsoft]], [['graph.microsoft.com', microsoft]]],
  [[['graph.microsoft.com', microsoft, microsoft, microsoft]], [['graph.microsoft.com', microsoft]]],
  [[['mcp.posthog.com', 'oauth.posthog.com']]],
  [[['mcp.tryprofound.com', 'auth.tryprofound.com']], [['mcp.tryprofound.com']]],
  keylessAt('searchads360.googleapis.com', 1),
  [[['slack.com']]],
  [[['mcp.stripe.com', 'access.stripe.com']], [['mcp.stripe.com']]],
  [[['workiq.svc.cloud.microsoft', microsoft, microsoft, microsoft]]],
  [[['api.x.com', 'api.x.com', 'x.com', 'api.x.com', 'api.x.com']]],
  [[['youtube.googleapis.com', google]]],
  [[['youtubeanalytics.googleapis.com', google]], [['youtubeanalytics.googleapis.com', google]]],
  [[['youtube.googleapis.com', google]]],
  [[['api.zoom.us', 'zoom.us', 'zoom.us', 'zoom.us', 'zoom.us']]],
];

const microsoftAmazonAndAdobe: ReadonlySet<string> = new Set([
  'adobe-analytics',
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

const notOfTheConsent: ReadonlySet<string> = new Set([
  'kind',
  'description',
  'says',
  'more',
  'account_types',
  'key_page',
  'key_page_title',
  'client_id_title',
  'steps',
  'refresh_token_expires_in',
]);

function fieldsOfConsent(way: CredentialWay): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(way).filter(([field]: readonly [string, unknown]) => !notOfTheConsent.has(field)),
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

function eachWay(scope: string, ways: number): readonly string[] {
  return Array.from({ length: ways }, () => scope);
}

function scopesOfEachWayAtGoogle({ name, credentials }: ProviderEntry) {
  return [name, credentials.map(({ scope = '' }) => namedAtGoogle(scope))];
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
      ['campaign-manager-360', eachWay('dfareporting dfatrafficking', 4)],
      ['display-video-360', eachWay('display-video', 4)],
      ['display-video-360-reports', eachWay('doubleclickbidmanager', 3)],
      ['gmail', ['gmail.readonly', 'gmail.readonly']],
      ['google-ads', eachWay('adwords', 4)],
      ['google-analytics', eachWay('analytics.readonly', 4)],
      ['google-analytics-admin', eachWay('analytics.readonly', 4)],
      ['google-docs', eachWay('documents.readonly documents', 4)],
      ['google-drive', eachWay('drive.readonly drive.file', 3)],
      ['google-search-console', eachWay('webmasters', 3)],
      ['google-sheets', eachWay('spreadsheets.readonly spreadsheets', 4)],
      ['google-slides', eachWay('presentations.readonly presentations', 4)],
      ['search-ads-360', eachWay('doubleclicksearch', 3)],
      ['youtube', ['youtube.readonly']],
      [
        'youtube-analytics',
        [
          'yt-analytics.readonly yt-analytics-monetary.readonly',
          'yt-analytics.readonly yt-analytics-monetary.readonly',
        ],
      ],
      ['youtube-management', ['youtube.force-ssl']],
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

const takingASeparateUser = ['amazon-ads', 'amazon-ads-mcp', 'buffer', 'linear', 'posthog', 'stripe'];

function accountsTakenBy(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  return entry.credentials
    .filter((way) => permissionsOf(way) === 'delegated')
    .map((way) => [accountTypesOf(way), accountTypeWhereNoneIsGiven(accountTypesOf(way))]);
}

describe('the ways of the shipped apps that let a company add a separate user', () => {
  it('take a service account and the account of the person who connects, and the person’s own where none is given', () => {
    expect(takingASeparateUser.map((name) => accountsTakenBy(name))).toEqual(
      takingASeparateUser.map(() => [[['service', 'personal'], 'personal']]),
    );
  });
});

const connectingAsTheCompany = ['atlassian', 'onedrive', 'stripe'];

function waysAfterTheSignInOf(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  const [first, ...later] = entry.credentials;
  return [
    first?.kind,
    later.map((way) => [way.kind, permissionsOf(way), accountTypesOf(way), way.limitation !== undefined]),
  ];
}

describe('the ways of the shipped apps that connect as the company, after the sign-in', () => {
  it('come after the sign-in way, each acting as the app or as a service account alone, and each stating what it cannot do', () => {
    expect(connectingAsTheCompany.map((name) => waysAfterTheSignInOf(name))).toEqual([
      ['authorization', [['secret', 'delegated', ['service'], true]]],
      ['authorization', [['client_credentials', 'application', [], true]]],
      ['authorization', [['secret', 'application', [], true]]],
    ]);
  });
});
