import type {
  ConnectionServer,
  ConnectionServerSettings,
  ConnectionSource,
  ConnectionUnready,
  OrgConnection,
} from '@on.auto/tool-servers';
import { pendingWords } from '@on.auto/tool-servers/testing';
import { Effect, Option, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import { added, billing, crm, crmWithTenant, notes } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness, fixtureServing, crmPolicy } from '../testing/harness.ts';
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

async function connected(h: Harness, input: unknown, given: Readonly<Record<string, string>> = {}): Promise<string> {
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

describe('the connections of an org as tool servers', () => {
  it('are each that is not removed, newest first, serving the playbooks its entry names, or every one', async () => {
    const h = harness();
    await added(h, crm);
    await connected(h, notes);
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
          'Nobody has approved the connection crm yet; the person who added it opens its link, or reconnects it for a new link',
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
    const id = await connected(h, crmWithTenant, { value: crmKey });

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
    const id = await connected(h, { ...notes, entry });

    const settings = await settingsOf(sourceOf(h, listing), id);

    expect([placedOf(settings).headers, settings.record_content]).toEqual([{ 'X-Tenant': 'acme$eu$$' }, false]);
  });
});

describe('a connected connection to an HTTP API as a tool server', () => {
  it('holds a secret of an HTTP API in its query or its security scheme, whole, read as the settings file reads one', async () => {
    const h = harness();
    const inQuery = await connected(
      h,
      { ...billing, name: 'billing-query', credential: { kind: 'secret', name: 'api_key', in: 'query' } },
      { value: 'billing-key-77a1c2' },
    );
    const inScheme = await connected(
      h,
      { ...billing, name: 'billing-scheme', credential: { kind: 'secret', name: 'apiKeyAuth', in: 'security' } },
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
    const withSecret = await connected(
      h,
      { ...billing, credential: { ...billing.credential, scope: 'invoices:read' } },
      { client_secret: 'billing-client-secret' },
    );
    const withKey = await connected(h, { ...billing, name: 'billing-key' }, { private_key: 'pem', algorithm: 'ES256' });
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

describe('a connected connection of a reference as a tool server', () => {
  it('sends the value of the variable a reference names, and is not allowed while the variable is not set', async () => {
    const listing = policyOf({ variables: ['NOTES_API_KEY'] });
    const h = harness(listing);
    const reference = { kind: 'reference', variable: 'NOTES_API_KEY', name: 'X-Api-Key', in: 'header' };
    const id = await connected(h, { ...notes, credential: reference });
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
    const id = await connected(h, { ...notes, credential: reference });
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
    const id = await connected(h, notes);

    const { reaches } = await connectedOf(sourceOf(h, policyOf({ allowed_hosts: ['*.example.com'] })), id);

    expect([await reaches(notes.entry.url), await reaches('https://other.example.org/mcp')]).toEqual([
      undefined,
      'A connection may not reach the host other.example.org on this runtime, which allows *.example.com',
    ]);
  });
});
