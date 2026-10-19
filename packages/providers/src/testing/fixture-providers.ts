import { Schema } from 'effect';

import { ProviderEntrySchema, type ProviderEntry } from '../entry/provider-entry.ts';
import { addressOf, type Provider, type ProviderList } from '../reading/provider-list.ts';

const decodeEntry = Schema.decodeUnknownSync(ProviderEntrySchema);

export const tracker: ProviderEntry = decodeEntry({
  name: 'tracker',
  title: 'Tracker',
  description: 'Read and change issues, projects and comments.',
  website: 'https://developer.tracker.example.com/mcp',
  type: 'mcp',
  url: 'https://{site}.tracker.example.com/mcp',
  placeholders: {
    site: {
      description: 'The subdomain of your site, as in https://<site>.tracker.example.com',
      pattern: '^[A-Za-z0-9-]{1,63}$',
      example: 'acme',
    },
  },
  credentials: [
    {
      kind: 'secret',
      in: 'header',
      name: 'Authorization',
      scheme: 'Bearer',
      description: "A personal access token from your account's settings.",
    },
    { kind: 'none', description: 'No credential, for a public site.' },
  ],
});

export const ledgers: ProviderEntry = decodeEntry({
  name: 'ledgers',
  title: 'Ledgers',
  description: 'Read and post the journal entries of one tenant.',
  website: 'https://developer.ledgers.example.com/api',
  type: 'openapi',
  document: 'https://ledgers.example.com/openapi.json',
  base_url: 'https://api.ledgers.example.com/{tenant}/v2',
  headers: { 'X-Client': '{client_id}', 'X-Manager': '{manager}', 'X-Format': 'json' },
  request_id: 'X-Request-Id',
  placeholders: {
    tenant: {
      description: 'Your tenant, as in https://api.ledgers.example.com/<tenant>',
      pattern: '^.{1,40}$',
      example: 'acme',
    },
    manager: {
      description: 'The id of the manager account you connect through, where you connect through one',
      pattern: '^[0-9]{10}$',
      example: '1234567890',
      required: false,
    },
  },
  credentials: [
    {
      kind: 'client_credentials',
      issuer: 'https://auth.ledgers.example.com/{tenant}',
      scope: 'journal.read journal.write',
      description: 'The client id and secret of a client registered for your tenant.',
    },
  ],
});

export const regions: ProviderEntry = decodeEntry({
  name: 'regions',
  title: 'Regions',
  description: 'Read the campaigns of one account, in the region it is kept in.',
  website: 'https://developer.regions.example.com',
  type: 'openapi',
  document: 'https://regions.example.com/openapi.json',
  base_url: 'https://{api_host}/v1',
  query_params: { account: '{account}' },
  placeholders: {
    region: {
      description: 'The region your account is kept in, which sets the host of the API',
      choices: [
        { value: 'na', title: 'North America', sets: { api_host: 'api-na.regions.example.com' } },
        { value: 'eu', title: 'Europe', sets: { api_host: 'api-eu.regions.example.com' } },
      ],
    },
    account: { description: 'The id of your account', pattern: '^[A-Za-z0-9]{1,32}$', example: 'acme1' },
  },
  credentials: [{ kind: 'secret', in: 'query', name: 'api_key' }],
});

export const metrics: ProviderEntry = decodeEntry({
  name: 'metrics',
  title: 'Metrics',
  description: 'Read the metrics of your campaigns.',
  website: 'https://developer.metrics.example.com',
  type: 'mcp',
  url: 'https://mcp.metrics.example.com/mcp',
  headers: { 'X-Developer-Token': '${METRICS_DEVELOPER_TOKEN}' },
  credentials: [{ kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' }],
});

export const drive: ProviderEntry = decodeEntry({
  name: 'drive',
  title: 'Drive',
  description: 'Read and change the files of an account.',
  website: 'https://developer.drive.example.com/mcp',
  type: 'mcp',
  url: 'https://mcp.drive.example.com/mcp',
  credentials: [
    {
      kind: 'authorization',
      issuer: 'https://accounts.drive.example.com',
      scope: 'files.read files.write',
      parameters: { access_type: 'offline', prompt: 'consent' },
      description: 'Sign in to Drive and allow Auto to read and change your files.',
    },
  ],
});

export const adverts: ProviderEntry = decodeEntry({
  name: 'adverts',
  title: 'Adverts',
  description: 'Read and manage the campaigns of an advertising account.',
  website: 'https://developer.adverts.example.com',
  type: 'openapi',
  document: 'https://adverts.example.com/openapi.json',
  base_url: 'https://api.adverts.example.com/v1',
  placeholders: {
    tenant: {
      description: 'Your tenant, as in https://login.adverts.example.com/<tenant>',
      pattern: '^[a-z0-9-]{1,40}$',
      example: 'common',
    },
  },
  credentials: [
    {
      kind: 'authorization',
      issuer: 'https://login.adverts.example.com/{tenant}/v2.0',
      scope: 'adverts.manage offline_access',
      authorization_endpoint: 'https://login.adverts.example.com/{tenant}/oauth2/v2.0/authorize',
      token_endpoint: 'https://login.adverts.example.com/{tenant}/oauth2/v2.0/token',
      revocation_endpoint: 'https://login.adverts.example.com/{tenant}/oauth2/v2.0/revoke',
      clients: ['registered', 'dynamic'],
      description: 'Sign in to Adverts and allow Auto to manage your campaigns.',
    },
    { kind: 'secret', in: 'header', name: 'X-Api-Key', description: 'An API key of your account.' },
  ],
});

function regionOf(value: string, title: string) {
  return {
    value,
    title,
    sets: { api_host: `api-${value}.campaigns.example.com`, token_host: `auth-${value}.campaigns.example.com` },
  };
}

export const campaigns: ProviderEntry = decodeEntry({
  name: 'campaigns',
  title: 'Campaigns',
  description: 'Read the campaigns of an account, in the region it is kept in.',
  website: 'https://developer.campaigns.example.com',
  type: 'openapi',
  document: 'https://campaigns.example.com/openapi.json',
  base_url: 'https://{api_host}/v1',
  placeholders: {
    region: {
      description: 'The region your account is kept in, which sets the hosts of the API and of its tokens',
      choices: [regionOf('na', 'North America'), regionOf('eu', 'Europe')],
    },
  },
  credentials: [
    {
      kind: 'authorization',
      issuer: 'https://auth.campaigns.example.com',
      scope: 'campaigns.read',
      authorization_endpoint: 'https://auth.campaigns.example.com/authorize',
      token_endpoint: 'https://{token_host}/oauth/token',
      revocation_endpoint: 'https://auth.campaigns.example.com/revoke',
    },
  ],
});

export function providerOf(entry: unknown, documentServer?: string): Provider {
  const decoded = decodeEntry(entry);
  return { entry: decoded, address: addressOf(decoded, documentServer) };
}

export function providerListOf(...providers: readonly Provider[]): ProviderList {
  return { providers, documents: import.meta.dirname };
}

export function providersOf(...entries: readonly unknown[]): ProviderList {
  return providerListOf(...entries.map((entry) => providerOf(entry)));
}

export const fixtureProviders: ProviderList = providersOf(ledgers, metrics, regions, tracker);
