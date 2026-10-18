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
