import { readFileSync } from 'node:fs';

import { additionOfProvider, type Provider, type ProviderAddition, providersShippedRoots } from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { describedToolServers, type ServerSettings, type ToolServers } from '@on.auto/tool-servers';
import { Effect, Option, Redacted, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionIssuesOf } from '../entries/entry-checks.ts';
import { credentialFieldIssuesOf } from '../registry/credential.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import {
  additions,
  checking,
  clientId,
  settingsOf,
  shipped,
  shippedCredentialsFile,
  shippedCredentialsText,
  shippedToolsFile,
  shippedToolsText,
} from '../testing/shipped-additions.ts';

const ToolsByWaySchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
);

type ToolsOfAWay = readonly [string, Readonly<Record<string, string>>];

type ToolsOfAProvider = readonly [string | undefined, readonly ToolsOfAWay[]];

function providerOfTheWay([way]: ToolsOfAWay): string | undefined {
  return way.split(', ')[0];
}

function toolSetsOf([provider, ways]: ToolsOfAProvider) {
  return [provider, new Set(ways.map(([, tools]: ToolsOfAWay) => JSON.stringify(tools))).size];
}

function toolSetsOfEachProvider(byWay: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  const byProvider = Map.groupBy(Object.entries(byWay), (way: ToolsOfAWay) => providerOfTheWay(way));
  return [...byProvider]
    .filter(([, ways]: ToolsOfAProvider) => ways.length > 1)
    .map((provider: ToolsOfAProvider) => toolSetsOf(provider));
}

describe('the tools every shipped document offers, by the way of each provider', () => {
  it('are committed as the bridge derives them, each tool by the digest of what an agent is listed and of the method, the path and the place of each input its call sends, so a change to where a shipped tool calls shows in its diff; pnpm --filter @on.auto/connections shipped-tools writes them again', async () => {
    expect(readFileSync(shippedToolsFile, 'utf8')).toBe(await shippedToolsText());
  });

  it('are the same tools, by name, by what an agent is listed and by the call each sends, for every way of one provider, wherever a way sends its calls', async () => {
    const byWay = Schema.decodeUnknownSync(ToolsByWaySchema)(await shippedToolsText());

    expect(toolSetsOfEachProvider(byWay)).toEqual([
      ['adobe-analytics', 1],
      ['campaign-manager-360', 1],
      ['display-video-360', 1],
      ['display-video-360-reports', 1],
      ['gmail', 1],
      ['google-ads', 1],
      ['google-analytics', 1],
      ['google-analytics-admin', 1],
      ['google-docs', 1],
      ['google-drive', 1],
      ['google-search-console', 1],
      ['google-sheets', 1],
      ['google-slides', 1],
      ['onedrive', 1],
      ['outlook', 1],
      ['search-ads-360', 1],
      ['youtube-analytics', 1],
      ['zoom', 2],
    ]);
  });
});

describe('the requests of every way of every shipped provider, by each example of its values', () => {
  it('are committed as the credential it records and the auth its server is read with, each way by their digest, so a change to how a shipped way asks for a token or a consent shows in its diff; pnpm --filter @on.auto/connections shipped-credentials writes them again', () => {
    expect(readFileSync(shippedCredentialsFile, 'utf8')).toBe(shippedCredentialsText());
  });
});

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const filesBesideTheEntries = await providersOnDisk.list({
  package: '@on.auto/providers',
  path: 'src/entries/documents',
});

const DocumentSchema = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
});

const ListedWaysSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(Schema.Struct({ credentials: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) })),
  }),
});

function operationsIn(document = ''): number {
  const { paths } = Schema.decodeUnknownSync(Schema.fromJsonString(DocumentSchema))(
    shipped.documents.get(document)?.text ?? '',
  );
  return Object.values(paths).flatMap((operations) => Object.keys(operations)).length;
}

function documentsBesideTheEntries(): readonly string[] {
  return filesBesideTheEntries
    .filter((file) => file.endsWith('.openapi.json'))
    .map((file) => `documents/${file}`)
    .toSorted();
}

function offeredOf({ name, entry }: ProviderAddition): readonly [string, number] {
  return [name, operationsIn(entry.document)];
}

function offeredOperationsOf({ servers }: ToolServers): readonly (readonly [string, number])[] {
  return servers.map((server) => [server.name, server.type === 'openapi' ? server.api.operations.length : 0]);
}

function headersOf(settings: ServerSettings): Readonly<Record<string, string>> {
  return settings.type === 'stdio'
    ? {}
    : Object.fromEntries(
        [...settings.headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [
          name,
          Redacted.value(value),
        ]),
      );
}

function isRegional({ placeholders }: ProviderAddition): boolean {
  return Object.hasOwn(placeholders, 'region');
}

function placesTheClientId({ entry }: ProviderAddition): boolean {
  return Object.values(entry.headers ?? {}).includes('{client_id}');
}

function hostsOf({ name, entry, credential }: ProviderAddition) {
  return [name, entry.url ?? entry.base_url, credential.authorization_endpoint, credential.token_endpoint];
}

async function waysListedWith(gateways: boolean): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const h = harness({ providers: shipped, consenting: { gateways } });
  const answer = await h.call(operationNamed(h.operations, 'list_providers'), ada);
  return Schema.decodeUnknownSync(ListedWaysSchema)(answer).output.providers.flatMap(({ credentials }) => credentials);
}

function namedProvider(name: string): Provider {
  return Option.getOrThrow(Option.fromNullishOr(shipped.providers.find(({ entry }) => entry.name === name)));
}

const regionalHosts = [
  [
    'amazon-ads',
    'https://advertising-api.amazon.com',
    'https://www.amazon.com/ap/oa',
    'https://api.amazon.com/auth/o2/token',
  ],
  [
    'amazon-ads',
    'https://advertising-api-eu.amazon.com',
    'https://eu.account.amazon.com/ap/oa',
    'https://api.amazon.co.uk/auth/o2/token',
  ],
  [
    'amazon-ads',
    'https://advertising-api-fe.amazon.com',
    'https://apac.account.amazon.com/ap/oa',
    'https://api.amazon.co.jp/auth/o2/token',
  ],
  ['amazon-ads-mcp', 'https://advertising-ai.amazon.com/mcp', undefined, undefined],
  ['amazon-ads-mcp', 'https://advertising-ai-eu.amazon.com/mcp', undefined, undefined],
  ['amazon-ads-mcp', 'https://advertising-ai-fe.amazon.com/mcp', undefined, undefined],
];

const advertiserAccount = 'amzn1.ads-account.g.26eqvvnjl03bvzcsjv6yp81x';

const placedClientIds = [
  ['adobe-analytics', { 'x-api-key': clientId }],
  ['adobe-analytics', { 'x-api-key': clientId }],
  ...Array.from({ length: 3 }, () => [
    'amazon-ads',
    { 'Amazon-Ads-ClientId': clientId, 'Amazon-Ads-AccountId': advertiserAccount },
  ]),
  ...Array.from({ length: 3 }, () => ['amazon-ads-mcp', { 'Amazon-Ads-ClientId': clientId }]),
];

describe('every way of every shipped provider, resolved with the examples of its placeholders and each choice', () => {
  it('passes the checks of the credential and of an addition that a connection added by hand passes', () => {
    expect(additions.map(({ name, credential }) => [name, credentialFieldIssuesOf(credential)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
    expect(additions.map((addition) => [addition.name, additionIssuesOf(addition, checking)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
  });

  it('places the hosts a region sets in the address and the endpoints of its way together', () => {
    expect(additions.filter((addition) => isRegional(addition)).map((addition) => hostsOf(addition))).toEqual(
      regionalHosts,
    );
  });

  it('sends the client id of the connection in the headers that hold {client_id}, a header named as a key among them', () => {
    const placing = additions.filter((addition) => placesTheClientId(addition));

    expect(placing.map((addition) => [addition.name, headersOf(settingsOf(addition))])).toEqual(placedClientIds);
  });

  it('sends no header of an optional placeholder the connection is added without, as an Amazon Ads connection without an account', () => {
    const withoutAnAccount = additionOfProvider(namedProvider('amazon-ads').entry, {
      placeholders: { region: 'na' },
      kind: 'authorization',
    });

    expect(headersOf(settingsOf(Result.getOrThrow(withoutAnAccount)))).toEqual({ 'Amazon-Ads-ClientId': clientId });
  });
});

describe('the listing of the shipped providers', () => {
  it('says of each way that sends a credential what a connection made through it acts as, and the kinds of account of each that acts as an account, with gateways switched on or off', async () => {
    const listed = [await waysListedWith(false), await waysListedWith(true)];

    expect(
      listed.map(
        (ways) => new Set(ways.map((way) => [way['permissions'], Object.hasOwn(way, 'account_types')].join())),
      ),
    ).toEqual([new Set(['application,false', 'delegated,true']), new Set(['application,false', 'delegated,true'])]);
    expect(listed.map((ways) => ways.length > 0)).toEqual([true, true]);
  });
});

describe('the documents beside the shipped entries', () => {
  it('are each offered whole by the reader of an HTTP API, every operation a tool within its bounds, a way of consent with the auth its serving gives', async () => {
    const leftOut: string[] = [];
    const described = additions.filter(({ type }) => type === 'openapi');
    const servers = await Effect.runPromise(
      describedToolServers(
        { servers: described.map((addition) => settingsOf(addition)), referencedVariables: [] },
        {
          reportLeftOut: (server, { operation, because }) => {
            leftOut.push(`${server}: ${operation}: ${because}`);
          },
        },
      ),
    );

    expect(leftOut).toEqual([]);
    expect(offeredOperationsOf(servers)).toEqual(described.map((addition) => offeredOf(addition)));
    expect([...new Set(described.map(({ entry }) => String(entry.document)))].toSorted()).toEqual(
      documentsBesideTheEntries(),
    );
    expect(described.length).toBeGreaterThan(0);
  });
});
