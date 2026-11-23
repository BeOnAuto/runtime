import { Buffer } from 'node:buffer';

import type { ProviderList } from '@on.auto/providers';
import { providerListOf, providerOf } from '@on.auto/providers/testing';
import type {
  ConnectionServer,
  ConnectionServerSettings,
  ConnectionSource,
  ConnectionUnready,
  OrgConnection,
} from '@on.auto/tool-servers';
import { fakeMcpInProcess, pendingWords, playbookToolCalls, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect, Option, Redacted, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { documentDecider, documentStreamOfOrg, keptTextOf } from '../documents/document-streams.ts';
import { type ConnectionPolicyFields, connectionPolicyOf } from '../policy/connection-policy.ts';
import { connectionRowsName } from '../registry/connection-rows.ts';
import { added, billing, crm, crmKeyHelp, crmWithTenant, notes } from '../testing/additions.ts';
import {
  accessThrough,
  askingThrough,
  connected,
  documentOf,
  elsewhere,
  served,
  toolsThrough,
} from '../testing/described-apis.ts';
import {
  ada,
  crmPolicy,
  fixtureServing,
  harness,
  type Harness,
  loopbackPolicy,
  operationNamed,
} from '../testing/harness.ts';
import { keptLedger } from '../testing/kept-ledger.ts';
import { watchedLedger } from '../testing/watched-ledger.ts';
import { makeConnectionSource } from './connection-source.ts';
import type { ServingServices } from './serving-services.ts';

const crmKey = 'Bearer crm-key-0f3c9a71';

function sourceOf(h: Harness, changes: Partial<Omit<ServingServices, 'registry'>> = {}): ConnectionSource {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    modelProviders: ['openai'],
    ...fixtureServing,
    ...changes,
  });
}

function policyOf(fields: ConnectionPolicyFields) {
  return { policy: connectionPolicyOf(fields) };
}

async function connectedConnectionSource(
  h: Harness,
  input: unknown,
  given: Readonly<Record<string, string>> = {},
): Promise<string> {
  const { id, token } = await added(h, input);
  const operation = Object.keys(given).length === 0 ? 'approve' : 'give_credential';
  await h.call(operationNamed(h.operations, operation), ada, { id, token, ...given });
  return id;
}

function listedBy(source: ConnectionSource): Promise<readonly OrgConnection[]> {
  return Effect.runPromise(source.connectionsOf('acme'));
}

async function serverOf(source: ConnectionSource, id: string): Promise<ConnectionServer | ConnectionUnready> {
  const connection = Option.getOrThrow(Option.fromNullishOr((await listedBy(source)).find((each) => each.id === id)));
  return connection.state.status === 'connected'
    ? Effect.runPromise(
        Effect.match(connection.state.server, {
          onSuccess: (server): ConnectionServer | ConnectionUnready => server,
          onFailure: (unready) => unready,
        }),
      )
    : connection.state.unready;
}

function isServer(answer: ConnectionServer | ConnectionUnready): answer is ConnectionServer {
  return 'settings' in answer;
}

async function connectedOf(source: ConnectionSource, id: string): Promise<ConnectionServer> {
  return Option.getOrThrow(Option.liftPredicate(await serverOf(source, id), isServer));
}

async function settingsOf(source: ConnectionSource, id: string): Promise<ConnectionServerSettings> {
  return (await connectedOf(source, id)).settings;
}

function revealed(values: ReadonlyMap<string, Redacted.Redacted>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...values].map(([key, value]: readonly [string, Redacted.Redacted]) => [key, Redacted.value(value)]),
  );
}

function placedOf(settings: ConnectionServerSettings) {
  return {
    headers: revealed(settings.headers),
    query: settings.type === 'openapi' ? revealed(settings.query_params) : {},
    security: settings.type === 'openapi' ? revealed(settings.security) : {},
    secrets: settings.secrets.map((secret) => Redacted.value(secret)),
  };
}

const DescribedSchema = Schema.Struct({ output: Schema.Struct({ description: Schema.String }) });

function descriptionIn(outcome: unknown): string {
  return Schema.decodeUnknownSync(DescribedSchema)(outcome).output.description;
}

const anyWords: unknown = expect.any(String);

interface LosingDocuments {
  readonly registry: ServingServices['registry'];
  readonly found: () => void;
}

function losingDocuments(h: Harness): LosingDocuments {
  const reading = { lost: true };
  const keptNothing = keptLedger().service;
  return {
    registry: {
      ...h.ledger.service,
      load: (stream, fold) =>
        reading.lost && stream.includes('/connection-documents/')
          ? keptNothing.load(stream, fold)
          : h.ledger.service.load(stream, fold),
    },
    found: () => {
      reading.lost = false;
    },
  };
}

const searching = { server: 'ledgers', tool: 'search', arguments: { query: 'acme' } };

describe('the connections of an org as tool servers', () => {
  it('are each that is not removed, newest first, serving the playbooks its entry names, or every one', async () => {
    const h = harness();
    await added(h, crm);
    await connectedConnectionSource(h, notes);
    const removed = await added(h, { ...notes, name: 'docs' });
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: removed.id });

    const listed = await listedBy(sourceOf(h));

    const servedByHand = { type: 'mcp', provider: null, orgs: ['acme'], record_content: true, request_id: null };

    expect(listed.map(({ serving, state }) => [serving, state.status])).toEqual([
      [{ ...servedByHand, name: 'notes', playbooks: null, allowed: null }, 'connected'],
      [{ ...servedByHand, name: 'crm', playbooks: ['sales'], allowed: ['search'] }, 'unready'],
    ]);
    expect(listed[1]?.state).toEqual({
      status: 'unready',
      unready: {
        because: 'connection_pending',
        detail:
          'Nobody has approved the connection crm yet; it needs to be approved on the page its link opens, or reconnected for a new link',
      },
    });
  });
});

describe('a connection nobody has approved', () => {
  it('is unready in the sentence the fake source of the tool servers answers for one', async () => {
    const h = harness();
    await added(h, crm);

    const [pending] = await listedBy(sourceOf(h));

    expect(pending?.state).toEqual({
      status: 'unready',
      unready: { because: 'connection_pending', detail: pendingWords('crm') },
    });
  });
});

describe('the connections of a runtime', () => {
  it('may be added while people may add them on this runtime', () => {
    const h = harness();

    expect([sourceOf(h).takesConnections, sourceOf(h, policyOf({ people_may_add: false })).takesConnections]).toEqual([
      true,
      false,
    ]);
  });
});

describe('a connected connection as a tool server', () => {
  it('holds its secret in the header it names, every value of it a secret and the credential after its scheme too', async () => {
    const h = harness({ policy: crmPolicy });
    const id = await connectedConnectionSource(h, crmWithTenant, { value: crmKey });

    const settings = await settingsOf(sourceOf(h, { policy: crmPolicy }), id);

    expect(settings).toMatchObject({
      type: 'mcp',
      name: 'crm',
      url: crm.entry.url,
      orgs: ['acme'],
      playbooks: ['sales'],
    });
    expect(placedOf(settings)).toEqual({
      headers: { 'X-Tenant': 'acme-eu', Authorization: crmKey },
      query: {},
      security: {},
      secrets: [crmKey, 'crm-key-0f3c9a71'],
    });
  });
});

describe('the entry of a connected connection', () => {
  it('is sent as it is written, a $ in it too, and keeps what it says of its content', async () => {
    const listing = policyOf({ allowed_hosts: ['notes.example.com'] });
    const h = harness(listing);
    const entry = { ...notes.entry, headers: { 'X-Tenant': 'acme$eu$$' }, record_content: false };
    const id = await connectedConnectionSource(h, { ...notes, entry });

    const settings = await settingsOf(sourceOf(h, listing), id);

    expect([placedOf(settings).headers, settings.record_content]).toEqual([{ 'X-Tenant': 'acme$eu$$' }, false]);
  });
});

describe('a connected connection to an HTTP API as a tool server', () => {
  it('holds a secret of an HTTP API in its query or its security scheme, whole, read as the settings file reads one', async () => {
    const h = harness();
    const inQuery = await connectedConnectionSource(
      h,
      {
        ...billing,
        name: 'billing-query',
        credential: { kind: 'secret', name: 'api_key', in: 'query', ...crmKeyHelp },
      },
      { value: 'billing-key-77a1c2' },
    );
    const inScheme = await connectedConnectionSource(
      h,
      {
        ...billing,
        name: 'billing-scheme',
        credential: { kind: 'secret', name: 'apiKeyAuth', in: 'security', ...crmKeyHelp },
      },
      { value: 'Basic billing-key-77a1c2' },
    );
    const source = sourceOf(h);

    const placed = [placedOf(await settingsOf(source, inQuery)), placedOf(await settingsOf(source, inScheme))];

    expect(placed).toEqual([
      { headers: {}, query: { api_key: 'billing-key-77a1c2' }, security: {}, secrets: ['billing-key-77a1c2'] },
      {
        headers: {},
        query: {},
        security: { apiKeyAuth: 'Basic billing-key-77a1c2' },
        secrets: ['Basic billing-key-77a1c2'],
      },
    ]);
  });
});

describe('a connected connection of client credentials as a tool server', () => {
  it('holds client credentials in its auth block, a client secret or a private key with its algorithm', async () => {
    const h = harness();
    const withSecret = await connectedConnectionSource(
      h,
      { ...billing, credential: { ...billing.credential, scope: 'invoices:read' } },
      { client_secret: 'billing-client-secret' },
    );
    const withKey = await connectedConnectionSource(
      h,
      { ...billing, name: 'billing-key' },
      { private_key: 'pem', algorithm: 'ES256' },
    );
    const source = sourceOf(h);

    const settings = [await settingsOf(source, withSecret), await settingsOf(source, withKey)];

    expect(settings).toMatchObject([
      {
        type: 'openapi',
        auth: {
          issuer: billing.credential.issuer,
          client_id: 'acme',
          scope: 'invoices:read',
          credential: { kind: 'client_secret' },
        },
      },
      { auth: { scope: null, credential: { kind: 'private_key', algorithm: 'ES256' } } },
    ]);
  });
});

const graphAppSecret = 'graph-app-client-secret-7d21';

function graphServerNaming(authorizationServers?: readonly string[]): FakeMcpServer {
  const fake = fakeMcpInProcess({
    client: {
      clientId: 'playbook',
      clientSecret: graphAppSecret,
      expiresInSeconds: 3600,
      ...(authorizationServers === undefined ? {} : { authorizationServers }),
    },
  });
  onTestFinished(fake.close);
  return fake;
}

function graphAppAt(server: FakeMcpServer): ProviderList {
  return providerListOf(
    providerOf({
      name: 'graph',
      title: 'Graph',
      description: 'Search the graph of an organization.',
      website: 'https://developer.graph.example.com',
      type: 'mcp',
      url: server.url,
      credentials: [
        {
          kind: 'client_credentials',
          issuer: server.origin,
          description: 'The client id and secret of an app your company registers at Graph.',
        },
      ],
    }),
  );
}

const searchingTheGraph = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

async function graphSearchedAs(input: unknown, given: Readonly<Record<string, string>>, providers: ProviderList) {
  const h = harness({ policy: loopbackPolicy, providers });
  await connectedConnectionSource(h, input, given);
  const asking = askingThrough();
  const tools = await toolsThrough(h, asking, { providers });
  return { called: await tools.call('execute_connection', searchingTheGraph), asking };
}

describe('the token of a connection of client credentials to an MCP server whose metadata names another authorization server', () => {
  it('is asked at the issuer its provider’s way names, with the resource the server names, where the connection is made from a provider', async () => {
    const named = graphServerNaming();
    const server = graphServerNaming([named.origin]);

    const { called, asking } = await graphSearchedAs(
      { provider: 'graph' },
      { client_id: 'playbook', client_secret: graphAppSecret },
      graphAppAt(server),
    );

    expect(called).toMatchObject({ status: 'succeeded' });
    expect([server.tokenRequests(), named.tokenRequests()]).toEqual([1, 0]);
    expect(asking.resources()).toEqual([server.url]);
    expect(named.heard()).toEqual([]);
  });

  it('is asked of no authorization server where the connection is given by hand, which asks the one its server names', async () => {
    const named = graphServerNaming();
    const server = graphServerNaming([named.origin]);
    const byHand = {
      name: 'graph',
      type: 'mcp',
      entry: { url: server.url },
      credential: { kind: 'client_credentials', issuer: server.origin, client_id: 'playbook' },
    };

    const { called } = await graphSearchedAs(byHand, { client_secret: graphAppSecret }, providerListOf());

    expect(called).toMatchObject({ status: 'rejected' });
    expect([server.tokenRequests(), named.tokenRequests()]).toEqual([0, 0]);
    expect(named.heard().map(({ path }) => path)).toContain('/.well-known/oauth-authorization-server');
  });
});

describe('a connected connection of a reference as a tool server', () => {
  it('sends the value of the variable a reference names, and is not allowed while the variable is not set', async () => {
    const listing = policyOf({ variables: ['NOTES_API_KEY'] });
    const h = harness(listing);
    const reference = { kind: 'reference', variable: 'NOTES_API_KEY', name: 'X-Api-Key', in: 'header' };
    const id = await connectedConnectionSource(h, { ...notes, credential: reference });
    const variables = new Map([['NOTES_API_KEY', Redacted.make('notes-key-5b2e9d')]]);

    const set = await settingsOf(sourceOf(h, { ...listing, variables }), id);
    const unset = await serverOf(sourceOf(h, listing), id);

    expect(placedOf(set)).toMatchObject({
      headers: { 'X-Api-Key': 'notes-key-5b2e9d' },
      secrets: ['notes-key-5b2e9d'],
    });
    expect(unset).toEqual({
      because: 'connection_not_allowed',
      detail:
        'The variable NOTES_API_KEY that the connection notes sends is not set on this runtime; whoever runs it sets the variable and starts it again',
    });
  });

  it('is refused in the words of the reading of its entry when the value it reads is one the entry cannot take', async () => {
    const listing = policyOf({ variables: ['NOTES_API_KEY'] });
    const h = harness(listing);
    const reference = { kind: 'reference', variable: 'NOTES_API_KEY', name: 'X-Api-Key', in: 'header' };
    const id = await connectedConnectionSource(h, { ...notes, credential: reference });
    const variables = new Map([['NOTES_API_KEY', Redacted.make('')]]);

    expect(await serverOf(sourceOf(h, { ...listing, variables }), id)).toEqual({
      because: 'connection_not_allowed',
      detail:
        'The entry of the connection notes is not one this runtime takes any more: Refers to the environment variable NOTES_API_KEY, which is not set',
    });
  });
});

describe('the hosts a connected connection reaches', () => {
  it('are only those the rules of the moment allow', async () => {
    const h = harness();
    const id = await connectedConnectionSource(h, notes);

    const { reaches } = await connectedOf(sourceOf(h, policyOf({ allowed_hosts: ['*.example.com'] })), id);

    expect([await reaches(notes.entry.url), await reaches('https://other.example.org/mcp')]).toEqual([
      undefined,
      'A connection may not reach the host other.example.org on this runtime, which allows *.example.com',
    ]);
  });
});

describe('an HTTP API given its document in document_text, once connected', () => {
  it('is served from the document its fact keeps, its calls going to base_url alone, asking no address for its document', async () => {
    const fake = served();
    const h = harness({ policy: loopbackPolicy });
    const asking = askingThrough();
    await connected(h, fake, documentOf());

    const called = await (
      await toolsThrough(h, asking)
    ).call('execute_connection', {
      server: 'ledgers',
      tool: 'search',
      arguments: { query: 'acme' },
    });

    expect(called).toMatchObject({ status: 'succeeded' });
    expect(fake.seen()).toMatchObject([{ method: 'GET', path: '/v1/search', query: '?query=acme' }]);
    expect(fake.documentReads()).toBe(0);
    expect(asking.asked().every((url) => url.startsWith(fake.baseUrl))).toBe(true);
  });
});

describe('the calls of an HTTP API given its document in document_text', () => {
  it('follow no redirect its service answers a call with, sending nothing where it points', async () => {
    const fake = served();
    const h = harness({ policy: loopbackPolicy });
    const asking = askingThrough();
    await connected(h, fake, documentOf());
    fake.answerNextWith({ status: 302, headers: { location: `${elsewhere}/v1/search` } });

    const called = await (
      await toolsThrough(h, asking)
    ).call('execute_connection', {
      server: 'ledgers',
      tool: 'search',
      arguments: { query: 'acme' },
    });

    expect(called).toMatchObject({
      status: 'succeeded',
      output: {
        outcome: 'tool_error',
        text: 'The tool server answered a redirect, HTTP 302, which a call does not follow',
      },
    });
    expect(asking.asked().filter((url) => url.startsWith(elsewhere))).toEqual([]);
  });

  it('show a model their words cut to the bound of any tool', async () => {
    const fake = served();
    const h = harness({ policy: loopbackPolicy });
    await connected(h, fake, documentOf({ description: 'The rows that match. '.repeat(400) }));

    const described = await (
      await toolsThrough(h, askingThrough())
    ).call('introspect', {
      server: 'ledgers',
      tool: 'search',
    });

    expect(Buffer.byteLength(descriptionIn(described))).toBe(4_096);
  });
});

describe('an HTTP API whose document is not where its record names it', () => {
  it('answers as failing, with nothing sent to its service, and is prepared again at its next use', async () => {
    const fake = served();
    const h = harness({ policy: loopbackPolicy });
    await connected(h, fake, documentOf());
    const losing = losingDocuments(h);
    const tools = await toolsThrough(h, askingThrough(), { registry: losing.registry });

    const failing = await tools.call('execute_connection', searching);
    const seenWhileLost = fake.seen().length;
    losing.found();
    const called = await tools.call('execute_connection', searching);

    expect(failing).toMatchObject({
      status: 'rejected',
      detail: anyWords,
    });
    expect([seenWhileLost, called]).toMatchObject([0, { status: 'succeeded' }]);
  });

  it('is never served with a document whose text is not the one its record names by its SHA-256 and size', async () => {
    const fake = served();
    const h = harness({ policy: loopbackPolicy });
    const text = documentOf();
    const other = documentOf({ description: 'Another text kept where the first was named.' });
    const keeping = { text: other, by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };
    await Effect.runPromise(
      h.ledger.service.execute(documentStreamOfOrg('acme', keptTextOf(text).sha256), documentDecider, keeping),
    );
    await connected(h, fake, text);

    const failing = await (await toolsThrough(h, askingThrough())).call('execute_connection', searching);

    expect(failing).toMatchObject({
      status: 'rejected',
      detail:
        'The tool server ledgers could not be used: The OpenAPI document kept for the connection ledgers is not the one it was added with',
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('the run check, the calls and the listings of an HTTP API given its document in document_text', () => {
  it('read its record through the one source of connections, its document read once, as the connection is first prepared', async () => {
    const fake = served();
    const ledger = watchedLedger();
    const h = harness({ policy: loopbackPolicy, ledger });
    const text = documentOf();
    await connected(h, fake, text);
    const access = await accessThrough(h, askingThrough());
    const tools = playbookToolCalls(access);
    const readSince = (before: number) => ledger.asked().slice(before);

    const beforeTheCheck = ledger.asked().length;
    await Effect.runPromise(access.named({ org: 'acme', playbook: 'alpha' }, [{ server: 'ledgers', tool: 'search' }]));
    const beforeTheCall = ledger.asked().length;
    const called = await tools.call('execute_connection', searching);
    const beforeTheListing = ledger.asked().length;
    await tools.call('introspect', { server: 'ledgers', tool: 'search' });

    const record = `rows ${connectionRowsName}`;
    expect(called).toMatchObject({ status: 'succeeded' });
    expect([
      readSince(beforeTheCheck).slice(0, beforeTheCall - beforeTheCheck),
      readSince(beforeTheCall).slice(0, beforeTheListing - beforeTheCall),
      readSince(beforeTheListing),
    ]).toEqual([[record, `load ${documentStreamOfOrg('acme', keptTextOf(text).sha256)}`], [record], [record]]);
  });
});
