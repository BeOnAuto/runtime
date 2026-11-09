import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scopesIn, type CredentialWay } from '@on.auto/providers';
import { drive, ledgers, providersOf, tracker } from '@on.auto/providers/testing';
import { Schema } from 'effect';

import { providersDocument, providersDocumentOf, shippedProviders } from './docs-providers.ts';

const ScopeSchema = Schema.Struct({ scope: Schema.String, says: Schema.String });

const WaySchema = Schema.Struct({
  kind: Schema.String,
  description: Schema.optionalKey(Schema.String),
  scopes: Schema.optionalKey(Schema.Array(ScopeSchema)),
  more: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, for: Schema.String, scopes: Schema.Array(ScopeSchema) })),
  ),
  own_client: Schema.optionalKey(Schema.Boolean),
  key_page: Schema.optionalKey(Schema.String),
  instructions: Schema.optionalKey(Schema.String),
});

const ToolSchema = Schema.Struct({ name: Schema.String, mark: Schema.Literals(['reads', 'acts']) });

const ProviderSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  website: Schema.String,
  server: Schema.Struct({ type: Schema.Literals(['mcp', 'openapi']), hosts: Schema.Array(Schema.String) }),
  ways: Schema.Array(WaySchema),
  placeholders: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.String,
      required: Schema.Boolean,
      choices: Schema.optionalKey(Schema.Array(Schema.Struct({ value: Schema.String, title: Schema.String }))),
    }),
  ),
  tools: Schema.optionalKey(Schema.Array(ToolSchema)),
  handles_money: Schema.Boolean,
});

type Published = typeof ProviderSchema.Type;

type PublishedWay = typeof WaySchema.Type;

const decodePublished = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      schema: Schema.Literal(1),
      source: Schema.Literal('@on.auto/providers'),
      providers: Schema.Array(ProviderSchema),
    }),
  ),
  { onExcessProperty: 'error' },
);

function publishedIn(document: string, name: string): Published {
  const found = decodePublished(document).providers.find((provider) => provider.name === name);
  if (found === undefined) {
    throw new Error(`${name} is not published`);
  }
  return found;
}

function shipped(name: string): Published {
  return publishedIn(providersDocument, name);
}

function wayAt({ ways }: Published, index: number): PublishedWay {
  const way = ways[index];
  if (way === undefined) {
    throw new Error(`There is no way ${index}`);
  }
  return way;
}

function entryWayOf(name: string): CredentialWay {
  const way = shippedProviders.providers.find(({ entry }) => entry.name === name)?.entry.credentials[0];
  if (way === undefined) {
    throw new Error(`${name} is not shipped`);
  }
  return way;
}

function keysIn(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((each: unknown) => keysIn(each));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return [...Object.keys(value), ...Object.values(value).flatMap((each: unknown) => keysIn(each))];
}

const fixtures = providersDocumentOf(providersOf(tracker, ledgers, drive));

await test('each shipped provider publishes its words, its server, its ways, whether it handles money, and its tools where Auto ships its document', () => {
  for (const { entry } of shippedProviders.providers) {
    const provider = shipped(entry.name);
    assert.deepEqual(
      [provider.title, provider.description, provider.website, provider.server.type, provider.handles_money],
      [entry.title, entry.description, entry.website, entry.type, entry.handles_money === true],
    );
    assert.deepEqual(
      provider.ways.map(({ kind, description }) => [kind, description]),
      entry.credentials.map(({ kind, description }) => [kind, description]),
    );
    assert.equal(provider.tools === undefined, entry.type === 'mcp', entry.name);
  }
  assert.equal(shipped('stripe').handles_money, true);
});

await test('a way of consent publishes the words of each scope it asks, in its order, and the groups a later consent adds', () => {
  const slack = entryWayOf('slack');
  assert.deepEqual(
    wayAt(shipped('slack'), 0).scopes,
    scopesIn(slack.scope).map((scope) => ({ scope, says: slack.says?.[scope] })),
  );
  assert.deepEqual([wayAt(shipped('slack'), 0).more, wayAt(shipped('slack'), 0).own_client], [[], false]);
  assert.deepEqual(wayAt(shipped('google-drive'), 0).more, [
    {
      name: 'edit',
      for: 'Change and delete files you already have.',
      scopes: [
        {
          scope: 'https://www.googleapis.com/auth/drive',
          says: "See, change, create and delete every file of the person's Google Drive.",
        },
      ],
    },
  ]);
  assert.equal(wayAt(shipped('x'), 0).own_client, true);
  assert.deepEqual(wayAt(shipped('hubspot'), 0).scopes, []);
});

await test('a way of a key publishes where the key is made and how', () => {
  assert.equal(wayAt(shipped('slack-bot'), 0).key_page, 'https://api.slack.com/apps');
  assert.match(String(wayAt(shipped('slack-bot'), 0).instructions), /It starts with `xoxb-`\.$/u);
});

await test('a server is published by its hosts, each region of one reached in regions, and a placeholder by its description and its choices', () => {
  assert.deepEqual(shipped('slack').server.hosts, ['slack.com']);
  assert.deepEqual(shipped('hubspot').server.hosts, ['mcp.hubspot.com']);
  assert.deepEqual(shipped('amazon-ads').server.hosts, [
    'advertising-api.amazon.com',
    'advertising-api-eu.amazon.com',
    'advertising-api-fe.amazon.com',
  ]);
  assert.deepEqual(
    shipped('amazon-ads').placeholders.map(({ name, required, choices }) => [name, required, choices]),
    [
      [
        'region',
        true,
        [
          { value: 'na', title: 'North America' },
          { value: 'eu', title: 'Europe' },
          { value: 'fe', title: 'Far East' },
        ],
      ],
      ['account_id', false, undefined],
    ],
  );
});

await test('nothing a connection is sent with is published: no issuer, endpoint, header, pattern or client', () => {
  const keys = new Set(keysIn(JSON.parse(providersDocument)));
  const sentWith = [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'revocation_endpoint',
    'headers',
    'query_params',
    'base_url',
    'url',
    'document',
    'pattern',
    'example',
    'sets',
    'in',
    'clients',
    'parameters',
    'failure_codes',
    'marks',
  ];
  assert.deepEqual(
    sentWith.filter((key) => keys.has(key)),
    [],
  );
  assert.doesNotMatch(providersDocument, /\{client_id\}|login-customer-id|Amazon-Ads-ClientId|\$\{/u);
});

await test('a way of each kind publishes its own fields, and nothing a kind does not take', () => {
  assert.deepEqual(publishedIn(fixtures, 'tracker').ways, [
    {
      kind: 'secret',
      description: 'Tracker personal access token',
      key_page: 'https://app.tracker.example.com/settings/keys',
      instructions:
        'Make a key at [app.tracker.example.com](https://app.tracker.example.com/settings/keys) under **Settings**, **Keys**, with read access.',
    },
    { kind: 'none', description: 'No credential, for a public site.' },
  ]);
  assert.deepEqual(publishedIn(fixtures, 'ledgers').ways, [
    {
      kind: 'client_credentials',
      description: 'The client id and secret of a client registered for your tenant.',
      scopes: [
        { scope: 'journal.read', says: 'Read the journal entries of the tenant.' },
        { scope: 'journal.write', says: 'Post journal entries to the tenant.' },
      ],
    },
  ]);
  assert.equal(wayAt(publishedIn(fixtures, 'drive'), 0).own_client, false);
  const undescribed = providersDocumentOf(providersOf({ ...tracker, credentials: [{ kind: 'none' }] }));
  assert.deepEqual(publishedIn(undescribed, 'tracker').ways, [{ kind: 'none' }]);
});

await test('a placeholder a person gives stays in the host it names, and an HTTP API whose document Auto does not ship lists no tools', () => {
  assert.deepEqual(publishedIn(fixtures, 'tracker').server.hosts, ['{site}.tracker.example.com']);
  assert.deepEqual(publishedIn(fixtures, 'tracker').placeholders, [
    {
      name: 'site',
      description: 'The subdomain of your site, as in https://<site>.tracker.example.com',
      required: true,
    },
  ]);
  assert.equal(publishedIn(fixtures, 'ledgers').tools, undefined);
});
