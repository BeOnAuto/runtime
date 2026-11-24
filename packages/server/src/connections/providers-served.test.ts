import { calledOpeningLinks } from '@on.auto/api/testing';
import { addressGivenWholeIn, hostAlternativesOf, operatorVariablesIn, type Provider } from '@on.auto/providers';
import { Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { registeredAtTheIssuers, shippedList, shippedProviders } from '../testing/servers/connected-servers.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

const names = shippedProviders.map(({ entry }) => entry.name);
const ListedSchema = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ name: Schema.String })),
  may_add: Schema.Boolean,
  refusal: Schema.NullOr(Schema.String),
});

function hostsOf(provider: Provider): readonly (readonly string[])[] {
  const givenWhole = `{${addressGivenWholeIn(provider.entry) ?? ''}}`;
  const hosts = provider.entry.credentials.flatMap((way) => hostAlternativesOf(provider, way));
  return hosts.map((each) => each.filter((host) => host !== givenWhole));
}

const github = Option.getOrThrow(Option.fromNullishOr(shippedProviders.find(({ entry }) => entry.name === 'github')));
function wayOf({ entry }: Provider, kind: string) {
  return Option.getOrThrow(Option.fromNullishOr(entry.credentials.find((way) => way.kind === kind)));
}

function placementOf(provider: Provider) {
  const { kind, in: placedIn, name, scheme } = wayOf(provider, 'secret');
  return { kind, in: placedIn, name, scheme };
}

function consentOf({ entry }: Provider) {
  const signingIn = entry.credentials.find((way) => way.kind === 'authorization' && way.installation === undefined);
  const { kind, issuer, scope, clients } = Option.getOrThrow(Option.fromNullishOr(signingIn));
  return { kind, issuer, scope, clients };
}

const SearchedSchema = Schema.Struct({ providers: Schema.Array(Schema.Struct({ name: Schema.String })) });
const WaysListedSchema = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      credentials: Schema.Array(
        Schema.Struct({
          kind: Schema.String,
          offered: Schema.Boolean,
          oauth_client: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
});

const refusedName = 'There is no provider named crm here; search lists the providers a person may connect';

let server: ReasoningServer;
beforeAll(async () => {
  server = await servingReasoning([]);
});

afterAll(async () => {
  await server.stop();
});

async function namesListedBy(served: ReasoningServer): Promise<readonly string[]> {
  const { body } = await served.call('GET', '/v1/orgs/local/providers');
  return Schema.decodeUnknownSync(ListedSchema)(body).providers.map(({ name }) => name);
}

describe('the providers a server lists over HTTP', () => {
  it('are the providers it ships, sorted by name, which the local developer may add', async () => {
    const answer = await server.call('GET', '/v1/orgs/local/providers');

    expect(answer).toMatchObject({ status: 200, body: { may_add: true, refusal: null } });
    expect(await namesListedBy(server)).toEqual(names);
    expect(names.length).toBeGreaterThan(0);
  });

  it('are those the rules of its operator could allow', async () => {
    const [allowed = []] = hostsOf(Option.getOrThrow(Option.fromNullishOr(shippedProviders[0])));
    const reached = shippedProviders.filter((provider) =>
      hostsOf(provider).some((hosts) => hosts.every((host) => allowed.includes(host))),
    );
    const served = await servingReasoning([], { CONNECTIONS: JSON.stringify({ allowed_hosts: allowed }) });
    onTestFinished(() => served.stop());

    expect(await namesListedBy(served)).toEqual(reached.map(({ entry }) => entry.name));
    expect(reached.length).toBeLessThan(names.length);
  });

  it('take no name a built-in model provider has, which every runtime would refuse a connection, and refer to no variable the runtime reads for itself, whose value a connection would send to the vendor', () => {
    const { modelProviders } = readSettingsOf({});

    expect(names.filter((name) => modelProviders.includes(name))).toEqual([]);
    expect(modelProviders.length).toBeGreaterThan(5);
    expect(operatorVariablesIn(shippedList).filter((name) => variablesTheRuntimeReads.includes(name))).toEqual([]);
    expect(variablesTheRuntimeReads.length).toBeGreaterThan(10);
  });
});

const alone = 'under the organization’s own OAuth client alone';

async function waysListedBy(served: ReasoningServer): Promise<readonly (readonly [string, readonly string[]])[]> {
  const { body } = await served.call('GET', '/v1/orgs/local/providers');
  return Schema.decodeUnknownSync(WaysListedSchema)(body).providers.map(({ name, credentials }) => [
    name,
    credentials.map(({ kind, offered, oauth_client: oauthClient }) =>
      [kind, offered ? 'offered' : 'set up first', oauthClient === 'required' ? alone : ''].join(' ').trim(),
    ),
  ]);
}

async function namesSearchedBy(served: ReasoningServer): Promise<readonly string[]> {
  const { body } = await served.call('GET', '/v1/orgs/local/tool-servers/search');
  return Schema.decodeUnknownSync(SearchedSchema)(body).providers.map(({ name }) => name);
}

function signingInAt(issuers: string): readonly string[] {
  return shippedProviders
    .filter(({ entry }) => entry.credentials.some(({ issuer = '' }) => issuer.startsWith(issuers)))
    .map(({ entry }) => entry.name);
}

const atGoogle = signingInAt('https://accounts.google.com');
const atMicrosoft = signingInAt('https://login.microsoftonline.com/');

const signingWithAKeyFile = shippedProviders
  .filter(({ entry }) => entry.credentials.some(({ kind }) => kind === 'jwt_bearer'))
  .map(({ entry }) => entry.name);

function withTheKeyFile(ways: readonly string[]): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(signingWithAKeyFile.map((name) => [name, ways]));
}

function waysExpected(
  ofTheOthers: Readonly<Record<string, readonly string[]>>,
  atGoogleAndMicrosoft: readonly string[],
): readonly (readonly [string, readonly string[]])[] {
  const known = {
    ...Object.fromEntries([...atGoogle, ...atMicrosoft].map((name) => [name, atGoogleAndMicrosoft])),
    ...ofTheOthers,
  };
  return names.map((name) => [name, Option.getOrThrow(Option.fromNullishOr(known[name]))]);
}

const underTheOrgsOAuthClientAlone = `authorization offered ${alone}`;
const waysWithoutAClient = {
  'adobe-analytics': ['client_credentials offered', underTheOrgsOAuthClientAlone],
  'amazon-ads': [underTheOrgsOAuthClientAlone],
  'amazon-ads-mcp': [underTheOrgsOAuthClientAlone],
  'apollo-graphos-agent-services': ['secret offered'],
  atlassian: ['authorization offered', 'secret offered'],
  buffer: ['secret offered'],
  ...withTheKeyFile(['jwt_bearer offered', underTheOrgsOAuthClientAlone]),
  github: ['secret offered', underTheOrgsOAuthClientAlone, 'jwt_bearer offered'],
  gmail: [underTheOrgsOAuthClientAlone, 'jwt_bearer offered'],
  'google-drive': [underTheOrgsOAuthClientAlone],
  hubspot: [underTheOrgsOAuthClientAlone],
  linear: ['authorization offered'],
  linkedin: [underTheOrgsOAuthClientAlone],
  notion: ['authorization offered'],
  onedrive: [underTheOrgsOAuthClientAlone, 'client_credentials offered'],
  outlook: [underTheOrgsOAuthClientAlone, 'client_credentials offered'],
  posthog: ['authorization offered'],
  profound: ['authorization offered', 'secret offered'],
  slack: [underTheOrgsOAuthClientAlone],
  'slack-bot': ['secret offered'],
  stripe: ['authorization offered', 'secret offered'],
  x: [underTheOrgsOAuthClientAlone],
  zoom: [underTheOrgsOAuthClientAlone, 'client_credentials offered'],
};

const waysWithAClient = {
  'adobe-analytics': ['client_credentials offered', 'authorization offered'],
  'amazon-ads': ['authorization offered'],
  'amazon-ads-mcp': ['authorization offered'],
  'apollo-graphos-agent-services': ['secret offered'],
  atlassian: ['authorization offered', 'secret offered'],
  buffer: ['secret offered'],
  ...withTheKeyFile(['authorization offered', 'jwt_bearer offered']),
  github: ['authorization offered', 'secret offered', 'jwt_bearer offered'],
  'google-drive': ['authorization offered'],
  hubspot: ['authorization offered'],
  linear: ['authorization offered'],
  linkedin: ['authorization offered'],
  notion: ['authorization offered'],
  onedrive: ['authorization offered', 'client_credentials offered'],
  outlook: ['authorization offered', 'client_credentials offered'],
  posthog: ['authorization offered'],
  profound: ['authorization offered', 'secret offered'],
  slack: ['authorization offered'],
  'slack-bot': ['secret offered'],
  stripe: ['authorization offered', 'secret offered'],
  x: [underTheOrgsOAuthClientAlone],
  zoom: ['authorization offered', 'client_credentials offered'],
};

describe('the ways of the providers a server lists', () => {
  it('offer consent beside the organization’s own OAuth client where whoever runs it registered a client at the issuer or the server registers one itself, under the organization’s own OAuth client alone elsewhere, and search offers every provider', async () => {
    const withoutClients = await servingReasoning([]);
    const withClients = await servingReasoning([], registeredAtTheIssuers);
    onTestFinished(withoutClients.stop);
    onTestFinished(withClients.stop);

    expect([await waysListedBy(withoutClients), await namesSearchedBy(withoutClients)]).toEqual([
      waysExpected(waysWithoutAClient, [underTheOrgsOAuthClientAlone]),
      names,
    ]);
    expect([await waysListedBy(withClients), await namesSearchedBy(withClients)]).toEqual([
      waysExpected(waysWithAClient, ['authorization offered']),
      names,
    ]);
    expect([atGoogle.length, atMicrosoft.length, signingWithAKeyFile.length]).toEqual([16, 5, 11]);
  });
});

describe('a connection added by a provider', () => {
  it('is added over HTTP by its name alone, by the first way the server offers: github by its token where no client is registered at the issuer of its consent, and by consent where one is', async () => {
    const withClients = await servingReasoning([], registeredAtTheIssuers);
    onTestFinished(() => withClients.stop());
    const { name, url } = github.entry;
    const pending = { name, type: 'mcp', provider: name, placeholders: {}, entry: { url }, status: 'pending' };

    const added = await Promise.all(
      [server, withClients].map((served) =>
        served.call('POST', '/v1/orgs/local/connections', { body: { provider: name } }),
      ),
    );

    expect(added).toMatchObject([
      { status: 201, body: { ...pending, credential: placementOf(github) } },
      { status: 201, body: { ...pending, credential: consentOf(github) } },
    ]);
  });

  it('is added over MCP by its name alone, and a provider the server has not is refused at /provider', async () => {
    const { name, url } = github.entry;
    const connection = { url: `${server.origin}/mcp`, headers: {} };

    const { answer } = await calledOpeningLinks(connection, {
      name: 'add_connection',
      arguments: { provider: name, name: 'added-over-mcp' },
    });
    const refused = await server.call('POST', '/v1/orgs/local/connections', { body: { provider: 'crm' } });

    expect(answer.structuredContent).toMatchObject({
      name: 'added-over-mcp',
      provider: name,
      placeholders: {},
      entry: { url },
      credential: placementOf(github),
    });
    expect(refused).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [{ pointer: '/provider', detail: refusedName }],
      },
    });
  });
});

describe('a connection added by a provider whose way requires the organization’s own OAuth client, as x’s does', () => {
  it('is added over HTTP by its name alone under the organization’s own OAuth client, whether or not a client is registered at its issuer', async () => {
    const withClients = await servingReasoning([], registeredAtTheIssuers);
    onTestFinished(() => withClients.stop());
    const added = await Promise.all(
      [server, withClients].map((served) =>
        served.call('POST', '/v1/orgs/local/connections', { body: { provider: 'x' } }),
      ),
    );
    const underTheOrgsOAuthClient = {
      status: 201,
      body: {
        name: 'x',
        provider: 'x',
        status: 'pending',
        credential: {
          kind: 'authorization',
          issuer: 'https://api.x.com',
          authorization_endpoint: 'https://x.com/i/oauth2/authorize',
          token_endpoint: 'https://api.x.com/2/oauth2/token',
          revocation_endpoint: 'https://api.x.com/2/oauth2/revoke',
          scope: 'tweet.read tweet.write users.read offline.access',
          client_source: 'own',
        },
      },
    };

    expect(added).toMatchObject([underTheOrgsOAuthClient, underTheOrgsOAuthClient]);
    expect(added[0]).not.toHaveProperty('body.credential.client_id');
    expect(added[1]).not.toHaveProperty('body.credential.client_id');
  });
});
