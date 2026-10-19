import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentServerOf, hostAlternativesOf, operatorVariablesOf, readProviders, type Provider } from '../index.ts';

const shipped = Result.getOrThrow(readProviders());

const entriesFolder = fileURLToPath(new URL('../entries/', import.meta.url));

function addressesOf({ entry, address }: Provider): readonly string[] {
  return [entry.website, address, ...entry.credentials.flatMap(({ issuer }) => (issuer === undefined ? [] : [issuer]))];
}

const google = 'https://accounts.google.com';

const googleScopes = 'https://www.googleapis.com/auth/';

const restrictedByGoogle = ['drive.readonly', 'gmail.modify'];

const googleProviders = [
  'campaign-manager-360',
  'display-video-360',
  'display-video-360-reports',
  'gmail',
  'google-ads',
  'google-analytics',
  'google-analytics-admin',
  'google-docs',
  'google-drive',
  'google-search-console',
  'google-sheets',
  'google-slides',
  'search-ads-360',
];

function signsInAtGoogle({ entry }: Provider): boolean {
  return googleProviders.includes(entry.name);
}

function documentServerExpectedOf({ entry, address }: Provider): string | undefined {
  return entry.type === 'openapi' ? address : undefined;
}

function waysOfConsentOf({ entry }: Provider) {
  return entry.credentials
    .filter(({ kind }) => kind === 'authorization')
    .map(({ issuer, parameters, clients }) => [entry.name, issuer, parameters, clients]);
}

function scopesOf({ entry }: Provider): readonly string[] {
  return entry.credentials.flatMap(({ scope = '' }) => scope.split(' ').filter((each) => each !== ''));
}

function restrictedOf(provider: Provider): readonly string[] {
  return restrictedByGoogle.filter((scope) => scopesOf(provider).includes(`${googleScopes}${scope}`));
}

function restrictedNamedBy({ entry }: Provider): readonly string[] {
  return restrictedByGoogle.filter((scope) => entry.description.includes(scope));
}

describe('the shipped providers', () => {
  it('are the entries of the folder, each named as its file, sorted by name and so each named once', () => {
    const names = shipped.providers.map(({ entry }) => entry.name);

    expect(names).toEqual([...googleProviders, 'github', 'profound', 'slack', 'slack-api', 'zoom'].toSorted());
    expect(names).toHaveLength(18);
    expect(
      readdirSync(entriesFolder)
        .filter((file) => file.endsWith('.yaml'))
        .toSorted(),
    ).toEqual(names.map((name) => `${name}.yaml`).toSorted());
    expect(new Set(names).size).toBe(names.length);
  });

  it('reach their servers, their pages and their issuers over https alone', () => {
    const addresses = shipped.providers.flatMap((provider) => addressesOf(provider));

    expect(addresses.filter((address) => !address.startsWith('https://'))).toEqual([]);
    expect(addresses.length).toBeGreaterThan(5);
  });
});

describe('the ways of the shipped providers', () => {
  it('take only the ways the runtime takes and refer to no value whoever runs the runtime sets', () => {
    expect(
      shipped.providers.map(({ entry }) => [
        entry.name,
        entry.credentials.map(({ kind }) => kind),
        operatorVariablesOf(entry),
      ]),
    ).toEqual([
      ['campaign-manager-360', ['authorization'], []],
      ['display-video-360', ['authorization'], []],
      ['display-video-360-reports', ['authorization'], []],
      ['github', ['authorization', 'secret'], []],
      ['gmail', ['authorization'], []],
      ['google-ads', ['authorization'], []],
      ['google-analytics', ['authorization'], []],
      ['google-analytics-admin', ['authorization'], []],
      ['google-docs', ['authorization'], []],
      ['google-drive', ['authorization'], []],
      ['google-search-console', ['authorization'], []],
      ['google-sheets', ['authorization'], []],
      ['google-slides', ['authorization'], []],
      ['profound', ['authorization', 'secret'], []],
      ['search-ads-360', ['authorization'], []],
      ['slack', ['authorization'], []],
      ['slack-api', ['secret'], []],
      ['zoom', ['authorization'], []],
    ]);
  });
});

describe('the servers of the shipped providers', () => {
  it('read the server an HTTP API calls from the document beside the entries, where the entry gives no base_url', () => {
    expect(shipped.providers.map(({ entry, address }) => [entry.name, address])).toEqual([
      ['campaign-manager-360', 'https://dfareporting.googleapis.com/dfareporting/v5'],
      ['display-video-360', 'https://displayvideo.googleapis.com'],
      ['display-video-360-reports', 'https://doubleclickbidmanager.googleapis.com/v2'],
      ['github', 'https://api.githubcopilot.com/mcp/'],
      ['gmail', 'https://gmailmcp.googleapis.com/mcp/v1'],
      ['google-ads', 'https://googleads.googleapis.com'],
      ['google-analytics', 'https://analyticsdata.googleapis.com'],
      ['google-analytics-admin', 'https://analyticsadmin.googleapis.com'],
      ['google-docs', 'https://docsmcp.googleapis.com/mcp/v1'],
      ['google-drive', 'https://drivemcp.googleapis.com/mcp/v1'],
      ['google-search-console', 'https://searchconsole.googleapis.com'],
      ['google-sheets', 'https://sheetsmcp.googleapis.com/mcp/v1'],
      ['google-slides', 'https://slidesmcp.googleapis.com/mcp/v1'],
      ['profound', 'https://mcp.tryprofound.com/mcp'],
      ['search-ads-360', 'https://searchads360.googleapis.com'],
      ['slack', 'https://mcp.slack.com/mcp'],
      ['slack-api', 'https://slack.com/api'],
      ['zoom', 'https://api.zoom.us/v2'],
    ]);
    expect(shipped.providers.map((provider) => documentServerOf(provider))).toEqual(
      shipped.providers.map((provider) => documentServerExpectedOf(provider)),
    );
    expect(shipped.documents).toBe(entriesFolder);
  });
});

describe('the hosts of the shipped providers', () => {
  it('are the host of their server and, for a way of consent, the host of its issuer', () => {
    expect(
      shipped.providers.map((provider) => provider.entry.credentials.map((way) => hostAlternativesOf(provider, way))),
    ).toEqual([
      [[['dfareporting.googleapis.com', 'accounts.google.com']]],
      [[['displayvideo.googleapis.com', 'accounts.google.com']]],
      [[['doubleclickbidmanager.googleapis.com', 'accounts.google.com']]],
      [[['api.githubcopilot.com', 'github.com']], [['api.githubcopilot.com']]],
      [[['gmailmcp.googleapis.com', 'accounts.google.com']]],
      [[['googleads.googleapis.com', 'accounts.google.com']]],
      [[['analyticsdata.googleapis.com', 'accounts.google.com']]],
      [[['analyticsadmin.googleapis.com', 'accounts.google.com']]],
      [[['docsmcp.googleapis.com', 'accounts.google.com']]],
      [[['drivemcp.googleapis.com', 'accounts.google.com']]],
      [[['searchconsole.googleapis.com', 'accounts.google.com']]],
      [[['sheetsmcp.googleapis.com', 'accounts.google.com']]],
      [[['slidesmcp.googleapis.com', 'accounts.google.com']]],
      [[['mcp.tryprofound.com', 'auth.tryprofound.com']], [['mcp.tryprofound.com']]],
      [[['searchads360.googleapis.com', 'accounts.google.com']]],
      [[['mcp.slack.com', 'mcp.slack.com']]],
      [[['slack.com']]],
      [[['api.zoom.us', 'zoom.us', 'zoom.us', 'zoom.us', 'zoom.us']]],
    ]);
  });
});

describe('the shipped providers of Google', () => {
  it('ask Google for an offline access and a consent prompt, through a client whoever runs the runtime registers', () => {
    const atGoogle = shipped.providers.filter((provider) => signsInAtGoogle(provider));

    expect(atGoogle.flatMap((provider) => waysOfConsentOf(provider))).toEqual(
      googleProviders.map((name) => [name, google, { access_type: 'offline', prompt: 'consent' }, ['registered']]),
    );
  });

  it('ask scopes of Google alone, and name in their description each one Google classifies as restricted', () => {
    const consenting = shipped.providers.filter((provider) => signsInAtGoogle(provider));

    expect(
      consenting.flatMap((provider) => scopesOf(provider)).filter((scope) => !scope.startsWith(googleScopes)),
    ).toEqual([]);
    expect(consenting.map((provider) => restrictedNamedBy(provider))).toEqual(
      consenting.map((provider) => restrictedOf(provider)),
    );
    expect(consenting.map((provider) => [provider.entry.name, restrictedOf(provider)])).toEqual([
      ['campaign-manager-360', []],
      ['display-video-360', []],
      ['display-video-360-reports', []],
      ['gmail', ['gmail.modify']],
      ['google-ads', []],
      ['google-analytics', []],
      ['google-analytics-admin', []],
      ['google-docs', ['drive.readonly']],
      ['google-drive', ['drive.readonly']],
      ['google-search-console', []],
      ['google-sheets', ['drive.readonly']],
      ['google-slides', ['drive.readonly']],
      ['search-ads-360', []],
    ]);
  });
});
