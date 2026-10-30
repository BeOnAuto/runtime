import { calledOpeningLinks } from '@on.auto/api/testing';
import { required } from '@on.auto/operations';
import { hostAlternativesOf, operatorVariablesIn, type Provider } from '@on.auto/providers';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { shippedList, shippedProviders } from '../testing/servers/connected-servers.ts';
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
  return provider.entry.credentials.flatMap((way) => hostAlternativesOf(provider, way));
}

const github = required(shippedProviders.find(({ entry }) => entry.name === 'github'));

function wayOf({ entry }: Provider, kind: string) {
  return required(entry.credentials.find((way) => way.kind === kind));
}

function placementOf(provider: Provider) {
  const { kind, in: placedIn, name, scheme } = wayOf(provider, 'secret');
  return { kind, in: placedIn, name, scheme };
}

function consentOf(provider: Provider) {
  const { kind, issuer, scope, clients } = wayOf(provider, 'authorization');
  return { kind, issuer, scope, clients };
}

const issuersOfConsent = shippedProviders.flatMap(({ entry }) =>
  entry.credentials.flatMap(({ kind, issuer }) => (kind === 'authorization' && issuer !== undefined ? [issuer] : [])),
);

const registeredAtTheIssuers = {
  CONNECTIONS: JSON.stringify({
    registered_clients: [
      { issuers: issuersOfConsent, client_id: 'auto-runtime', client_secret: '${REGISTERED_CLIENT_SECRET}' },
    ],
  }),
  REGISTERED_CLIENT_SECRET: 'the secret of the client registered at every issuer',
};

const SearchedSchema = Schema.Struct({ providers: Schema.Array(Schema.Struct({ name: Schema.String })) });

const WaysListedSchema = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      credentials: Schema.Array(
        Schema.Struct({ kind: Schema.String, offered: Schema.Boolean, own_app: Schema.optionalKey(Schema.String) }),
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
    const allowed = required(hostsOf(required(shippedProviders[0]))[0]);
    const reached = shippedProviders.filter((provider) =>
      hostsOf(provider).some((hosts) => hosts.every((host) => allowed.includes(host))),
    );
    const served = await servingReasoning([], { CONNECTIONS: JSON.stringify({ allowed_hosts: allowed }) });
    onTestFinished(() => served.stop());

    expect(await namesListedBy(served)).toEqual(reached.map(({ entry }) => entry.name));
    expect(reached.length).toBeLessThan(names.length);
  });

  it('take no name a built-in model provider has, which every runtime would refuse a connection', () => {
    const { modelProviders } = readSettingsOf({});

    expect(names.filter((name) => modelProviders.includes(name))).toEqual([]);
    expect(modelProviders.length).toBeGreaterThan(5);
  });

  it('refer to no variable the runtime reads for itself, whose value a connection would send to the vendor', () => {
    expect(operatorVariablesIn(shippedList).filter((name) => variablesTheRuntimeReads.includes(name))).toEqual([]);
    expect(variablesTheRuntimeReads.length).toBeGreaterThan(10);
  });
});

const alone = 'under the org’s own app alone';

async function waysListedBy(served: ReasoningServer): Promise<readonly (readonly [string, readonly string[]])[]> {
  const { body } = await served.call('GET', '/v1/orgs/local/providers');
  return Schema.decodeUnknownSync(WaysListedSchema)(body).providers.map(({ name, credentials }) => [
    name,
    credentials.map(({ kind, offered, own_app: ownApp }) =>
      [kind, offered ? 'offered' : 'set up first', ownApp === 'required' ? alone : ''].join(' ').trim(),
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

function waysExpected(
  ofTheOthers: Readonly<Record<string, readonly string[]>>,
  atGoogleAndMicrosoft: readonly string[],
): readonly (readonly [string, readonly string[]])[] {
  const known = {
    ...Object.fromEntries([...atGoogle, ...atMicrosoft].map((name) => [name, atGoogleAndMicrosoft])),
    ...ofTheOthers,
  };
  return names.map((name) => [name, required(known[name])]);
}

const underTheOrgsAppAlone = `authorization offered ${alone}`;

const waysWithoutAClient = {
  'adobe-analytics': ['client_credentials offered', underTheOrgsAppAlone],
  'adobe-analytics-mcp': ['authorization offered'],
  'amazon-ads': [underTheOrgsAppAlone],
  'amazon-ads-mcp': [underTheOrgsAppAlone],
  atlassian: ['authorization offered'],
  buffer: ['secret offered'],
  github: ['secret offered', underTheOrgsAppAlone],
  'google-drive': [underTheOrgsAppAlone],
  hubspot: [underTheOrgsAppAlone],
  linear: ['authorization offered'],
  linkedin: [underTheOrgsAppAlone],
  notion: ['authorization offered'],
  posthog: ['authorization offered'],
  profound: ['authorization offered', 'secret offered'],
  slack: [underTheOrgsAppAlone],
  'slack-bot': ['secret offered'],
  stripe: ['authorization offered'],
  zoom: [underTheOrgsAppAlone],
};

const waysWithAClient = {
  'adobe-analytics': ['client_credentials offered', 'authorization offered'],
  'adobe-analytics-mcp': ['authorization offered'],
  'amazon-ads': ['authorization offered'],
  'amazon-ads-mcp': ['authorization offered'],
  atlassian: ['authorization offered'],
  buffer: ['secret offered'],
  github: ['authorization offered', 'secret offered'],
  'google-drive': ['authorization offered'],
  hubspot: ['authorization offered'],
  linear: ['authorization offered'],
  linkedin: ['authorization offered'],
  notion: ['authorization offered'],
  posthog: ['authorization offered'],
  profound: ['authorization offered', 'secret offered'],
  slack: ['authorization offered'],
  'slack-bot': ['secret offered'],
  stripe: ['authorization offered'],
  zoom: ['authorization offered'],
};

describe('the ways of the providers a server lists', () => {
  it('offer consent beside the org’s own app where whoever runs it registered a client at the issuer or the server registers one itself, under the org’s own app alone elsewhere, and search offers every provider', async () => {
    const withClients = await servingReasoning([], registeredAtTheIssuers);
    onTestFinished(() => withClients.stop());

    expect([await waysListedBy(server), await namesSearchedBy(server)]).toEqual([
      waysExpected(waysWithoutAClient, [underTheOrgsAppAlone]),
      names,
    ]);
    expect([await waysListedBy(withClients), await namesSearchedBy(withClients)]).toEqual([
      waysExpected(waysWithAClient, ['authorization offered']),
      names,
    ]);
    expect([atGoogle.length, atMicrosoft.length]).toEqual([16, 5]);
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
