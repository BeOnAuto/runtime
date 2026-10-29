import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { shippedFileIn } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  documentServerOf,
  operatorVariablesOf,
  readProviders,
  type Provider,
  providersShippedRoots,
} from '../index.ts';
import { shippedEntries } from './shipped-providers.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const entriesUrl = new URL('../entries/', import.meta.url);

const entriesFolder = fileURLToPath(entriesUrl);

const documentsBesideTheEntries = shipped.providers
  .flatMap(({ entry }) => (entry.document === undefined || URL.canParse(entry.document) ? [] : [entry.document]))
  .toSorted();

function addressesOf({ entry, address }: Provider): readonly string[] {
  return [entry.website, address, ...entry.credentials.flatMap(({ issuer }) => (issuer === undefined ? [] : [issuer]))];
}

const google = 'https://accounts.google.com';

const microsoftGraph = 'https://graph.microsoft.com/v1.0';

const googleScopes = 'https://www.googleapis.com/auth/';

const restrictedByGoogle = ['drive.readonly', 'gmail.readonly'];

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
  'youtube',
  'youtube-analytics',
  'youtube-management',
];

const googleWaysOfConsent = [...googleProviders, 'google-drive'].toSorted();

const microsoftAmazonAndAdobe = [
  'adobe-analytics',
  'adobe-analytics-mcp',
  'amazon-ads',
  'amazon-ads-mcp',
  'microsoft-advertising',
  'microsoft-teams',
  'onedrive',
  'outlook',
  'work-iq',
];

function signsInAtGoogle({ entry }: Provider): boolean {
  return googleProviders.includes(entry.name);
}

function documentServerExpectedOf({ entry, address }: Provider): string | undefined {
  return entry.type === 'openapi' && entry.base_url === undefined ? address : undefined;
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

const addressesOfTheShipped = [
  ['adobe-analytics', 'https://analytics.adobe.io/api/{global_company_id}'],
  ['adobe-analytics-mcp', 'https://aa-mcp.adobe.io/mcp'],
  ['amazon-ads', 'https://{api_host}'],
  ['amazon-ads-mcp', 'https://{mcp_host}/mcp'],
  ['atlassian', 'https://mcp.atlassian.com/v2/mcp?tools=all'],
  ['buffer', 'https://mcp.buffer.com/mcp'],
  ['campaign-manager-360', 'https://dfareporting.googleapis.com/dfareporting/v5'],
  ['display-video-360', 'https://displayvideo.googleapis.com'],
  ['display-video-360-reports', 'https://doubleclickbidmanager.googleapis.com/v2'],
  ['github', 'https://api.githubcopilot.com/mcp/'],
  ['gmail', 'https://gmail.googleapis.com'],
  ['google-ads', 'https://googleads.googleapis.com'],
  ['google-analytics', 'https://analyticsdata.googleapis.com'],
  ['google-analytics-admin', 'https://analyticsadmin.googleapis.com'],
  ['google-docs', 'https://docs.googleapis.com'],
  ['google-drive', 'https://www.googleapis.com/drive/v3'],
  ['google-search-console', 'https://searchconsole.googleapis.com'],
  ['google-sheets', 'https://sheets.googleapis.com'],
  ['google-slides', 'https://slides.googleapis.com'],
  ['hubspot', 'https://mcp.hubspot.com'],
  ['linear', 'https://mcp.linear.app/mcp'],
  ['microsoft-advertising', 'https://partner.api.bingads.microsoft.com/ext/mcp/vnext?toolSetNames=OpenBeta'],
  ['microsoft-teams', microsoftGraph],
  ['notion', 'https://mcp.notion.com/mcp'],
  ['onedrive', microsoftGraph],
  ['outlook', microsoftGraph],
  ['posthog', 'https://mcp.posthog.com/mcp?mode=tools'],
  ['profound', 'https://mcp.tryprofound.com/mcp'],
  ['search-ads-360', 'https://searchads360.googleapis.com'],
  ['slack', 'https://mcp.slack.com/mcp'],
  ['slack-api', 'https://slack.com/api'],
  ['stripe', 'https://mcp.stripe.com'],
  ['work-iq', 'https://workiq.svc.cloud.microsoft/mcp'],
  ['youtube', 'https://youtube.googleapis.com'],
  ['youtube-analytics', 'https://youtubeanalytics.googleapis.com'],
  ['youtube-management', 'https://youtube.googleapis.com'],
  ['zoom', 'https://api.zoom.us/v2'],
];

describe('the shipped providers', () => {
  it('are the entries of the folder, each named as its file, sorted by name and so each named once', () => {
    const names = shipped.providers.map(({ entry }) => entry.name);

    expect(names).toEqual(
      [
        ...googleProviders,
        ...microsoftAmazonAndAdobe,
        'atlassian',
        'buffer',
        'github',
        'hubspot',
        'linear',
        'notion',
        'posthog',
        'profound',
        'slack',
        'slack-api',
        'stripe',
        'zoom',
      ].toSorted(),
    );
    expect(names).toHaveLength(37);
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
      ['adobe-analytics', ['client_credentials', 'authorization'], []],
      ['adobe-analytics-mcp', ['authorization'], []],
      ['amazon-ads', ['authorization'], []],
      ['amazon-ads-mcp', ['authorization'], []],
      ['atlassian', ['authorization'], []],
      ['buffer', ['authorization'], []],
      ['campaign-manager-360', ['authorization'], []],
      ['display-video-360', ['authorization'], []],
      ['display-video-360-reports', ['authorization'], []],
      ['github', ['authorization', 'secret'], []],
      ['gmail', ['authorization'], []],
      ['google-ads', ['authorization'], []],
      ['google-analytics', ['authorization'], []],
      ['google-analytics-admin', ['authorization'], []],
      ['google-docs', ['authorization'], []],
      ['google-drive', ['authorization', 'authorization'], []],
      ['google-search-console', ['authorization'], []],
      ['google-sheets', ['authorization'], []],
      ['google-slides', ['authorization'], []],
      ['hubspot', ['authorization'], []],
      ['linear', ['authorization'], []],
      ['microsoft-advertising', ['authorization'], []],
      ['microsoft-teams', ['authorization'], []],
      ['notion', ['authorization'], []],
      ['onedrive', ['authorization'], []],
      ['outlook', ['authorization'], []],
      ['posthog', ['authorization'], []],
      ['profound', ['authorization', 'secret'], []],
      ['search-ads-360', ['authorization'], []],
      ['slack', ['authorization'], []],
      ['slack-api', ['secret'], []],
      ['stripe', ['authorization'], []],
      ['work-iq', ['authorization'], []],
      ['youtube', ['authorization'], []],
      ['youtube-analytics', ['authorization'], []],
      ['youtube-management', ['authorization'], []],
      ['zoom', ['authorization'], []],
    ]);
  });
});

describe('the servers of the shipped providers', () => {
  it('read the server an HTTP API calls from the document beside the entries, where the entry gives no base_url', () => {
    expect(shipped.providers.map(({ entry, address }) => [entry.name, address])).toEqual(addressesOfTheShipped);
    expect(shipped.providers.map((provider) => documentServerOf(provider))).toEqual(
      shipped.providers.map((provider) => documentServerExpectedOf(provider)),
    );
  });

  it('hand on the documents beside the entries as the texts they read with the bytes each takes, by the name each entry writes', async () => {
    const onDisk = await Promise.all(
      documentsBesideTheEntries.map(async (written) => {
        const file = shippedFileIn(shippedEntries, written);
        return { text: await providersOnDisk.text(file), bytes: (await providersOnDisk.bytes(file)).byteLength };
      }),
    );

    expect([...shipped.documents.keys()].toSorted()).toEqual(documentsBesideTheEntries);
    expect(documentsBesideTheEntries.map((written) => shipped.documents.get(written))).toEqual(onDisk);
    expect(documentsBesideTheEntries.length).toBeGreaterThan(0);
  });
});

describe('the shipped providers of Google', () => {
  it('ask Google, in every way of consent, for an offline access and a consent prompt, through a client whoever runs the runtime registers', () => {
    const atGoogle = shipped.providers.filter((provider) => signsInAtGoogle(provider));

    expect(atGoogle.flatMap((provider) => waysOfConsentOf(provider))).toEqual(
      googleWaysOfConsent.map((name) => [name, google, { access_type: 'offline', prompt: 'consent' }, ['registered']]),
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
      ['gmail', ['gmail.readonly']],
      ['google-ads', []],
      ['google-analytics', []],
      ['google-analytics-admin', []],
      ['google-docs', []],
      ['google-drive', ['drive.readonly']],
      ['google-search-console', []],
      ['google-sheets', []],
      ['google-slides', []],
      ['search-ads-360', []],
      ['youtube', []],
      ['youtube-analytics', []],
      ['youtube-management', []],
    ]);
  });
});

describe('the roots of the files the providers ship', () => {
  it('load where import.meta.url names no file, and are named only when the files are read', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./shipped-providers.ts', import.meta.url));

    expect(Object.keys(loaded)).toContain('providersShippedRoots');
    expect(providersShippedRoots()).toEqual({ '@on.auto/providers': new URL('../../', import.meta.url) });
  });
});
