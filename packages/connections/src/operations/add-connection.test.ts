import { createHash } from 'node:crypto';

import { servedStudio } from '@on.auto/identity/testing';
import { fixtureProviders, providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import {
  added,
  adding,
  billing,
  crm,
  crmWithTenant,
  issuesIn,
  namesIn,
  notes,
  statusesOf,
} from '../testing/additions.ts';
import {
  acmeReader,
  acmeViewer,
  ada,
  crmPolicy,
  harness,
  harnessPages,
  operationNamed,
  type Harness,
} from '../testing/harness.ts';

const anyWords: unknown = expect.any(String);

const heldValues = [
  [
    'a credential in the query of its url',
    { ...crm.entry, url: 'https://crm.example.com/mcp?api_key=abc123' },
    '/entry/url',
    "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens",
  ],
  [
    'a value that looks like a credential',
    { ...crm.entry, headers: { Authorization: 'Bearer sk-live-0123456789abcdef' } },
    '/entry/headers/Authorization',
    "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens",
  ],
  [
    'a reference to an environment variable',
    { ...crm.entry, headers: { 'X-Tenant': '${CRM_TENANT}' } },
    '/entry/headers/X-Tenant',
    "Holds a reference to an environment variable, which a connection's entry never holds: a reference credential names the variable",
  ],
] as const;

const refusedEntries = [
  ['a name of the wrong shape', { ...notes, name: 'Notes' }, '/name'],
  ['the name of a model provider', { ...notes, name: 'openai' }, '/name'],
  ['a url that is no web address', { ...notes, entry: { url: 'ftp://notes.example.com' } }, '/entry/url'],
  ['an http url off the loopback', { ...notes, entry: { url: 'http://notes.example.com/mcp' } }, '/entry/url'],
  [
    'a field of another kind',
    { ...notes, entry: { ...notes.entry, base_url: 'https://x.example' } },
    '/entry/base_url',
  ],
  ['an mcp connection without its url', { ...notes, entry: {} }, '/entry'],
  ['a document on the disk of the runtime', { ...billing, entry: { document: 'openapi.json' } }, '/entry/document'],
  [
    'a playbook that is no playbook id',
    { ...notes, entry: { ...notes.entry, playbooks: ['Sales'] } },
    '/entry/playbooks/0',
  ],
  ['a tool listed twice', { ...notes, entry: { ...notes.entry, allowed: ['search', 'search'] } }, '/entry/allowed/1'],
] as const;

function naming(variable: string) {
  return { ...notes, credential: { kind: 'reference', variable, name: 'Authorization', in: 'header' } };
}

const marks = { reads: ['search'] };

const anyRenders: unknown = expect.any(String);

function withoutRenders(): unknown {
  return expect.not.objectContaining({ renders: anyRenders });
}

const cards = providerOf({ ...tracker, renders: 'cards' });

const providers = providerListOf(...fixtureProviders.providers.filter(({ entry }) => entry.name !== 'tracker'), cards);

const tracked = { provider: 'tracker', placeholders: { site: 'acme' }, credential: { kind: 'none' } };

const unrendered = {
  name: 'notes',
  type: 'mcp',
  entry: { url: 'https://notes.example.com/mcp' },
  credential: { kind: 'none' },
};

const earlier = '2026-10-15T13:00:00.000Z';

describe('the answer to adding a connection', () => {
  it('is the connection pending, added by the caller, and the time its link expires, 24 hours on', async () => {
    expect(await adding(harness({ policy: crmPolicy }), crmWithTenant)).toMatchObject({
      status: 'succeeded',
      output: {
        name: 'crm',
        type: 'mcp',
        entry: {
          url: 'https://crm.example.com/mcp',
          headers: { 'X-Tenant': 'acme-eu' },
          allowed: ['search'],
          playbooks: ['sales'],
        },
        credential: { kind: 'secret', name: 'Authorization', in: 'header' },
        status: 'pending',
        added_by: { id: 'person:ada', name: 'Ada Lovelace' },
        added_at: '2026-10-15T14:00:00.000Z',
        connected_at: null,
        connected_by: null,
        broken: null,
        connect: { expires_at: '2026-10-16T14:00:00.000Z' },
      },
    });
  });

  it("links to Studio's page, naming the runtime, the org, the connection and a token of 32 random bytes", async () => {
    const { id, url, token } = await added(harness(), notes);

    const page = new URL(url);
    expect([page.origin, page.pathname, Object.fromEntries(page.searchParams)]).toEqual([
      'https://studio.on.auto',
      '/connect',
      { server: 'http://localhost:5555', org: 'acme', connection: id, token },
    ]);
    expect(token).toMatch(/^[\w-]{43}$/u);
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-7/u);
  });
});

describe('the facts of adding a connection', () => {
  it('are the connection and the SHA-256 of its token, never the token, each with who and when', async () => {
    const h = harness();

    const { id, token } = await added(h, crm);

    const facts = await h.facts();
    expect(facts.map(({ type, context }) => [type, context])).toEqual([
      ['connection_added', { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' }],
      ['connection_link_issued', { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' }],
    ]);
    expect(facts[1]?.data).toEqual({
      connection: id,
      token_sha256: createHash('sha256').update(token).digest('hex'),
      expires_at: '2026-10-16T14:00:00.000Z',
    });
    expect(JSON.stringify(facts)).not.toContain(token);
  });

  it('hold an openapi entry, with the playbooks it names', async () => {
    expect(
      await adding(harness(), { ...billing, entry: { ...billing.entry, playbooks: ['billing-runs'] } }),
    ).toMatchObject({
      status: 'succeeded',
      output: { type: 'openapi', entry: { playbooks: ['billing-runs'] }, credential: { kind: 'client_credentials' } },
    });
  });
});

describe('an entry that holds what a connection never holds', () => {
  it.each(heldValues)('is refused for %s, without the value', async (_, entry, pointer, detail) => {
    const outcome = await adding(harness(), { ...crm, entry, credential: { kind: 'none' } });

    expect(issuesIn(outcome)).toEqual([{ pointer, detail }]);
    expect(JSON.stringify(outcome)).not.toMatch(/sk-live|CRM_TENANT|abc123/u);
  });
});

describe('a value written beside a placeholder under the name of a credential', () => {
  it('is judged as a value written out, in a header and in a query parameter given by hand', async () => {
    const held =
      "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens";
    const header = { ...crm, entry: { ...crm.entry, headers: { 'X-Api-Key': 'key-{client_id}' } } };
    const query = { ...billing, entry: { ...billing.entry, query_params: { api_key: 'abc{tenant}' } } };

    expect([
      issuesIn(await adding(harness(), { ...header, credential: { kind: 'none' } })),
      issuesIn(await adding(harness(), { ...query, credential: { kind: 'none' } })),
    ]).toEqual([
      [{ pointer: '/entry/headers/X-Api-Key', detail: held }],
      [{ pointer: '/entry/query_params/api_key', detail: held }],
    ]);
  });
});

describe('an entry the checks of a file entry refuse', () => {
  it.each(refusedEntries)('is refused for %s, at its place', async (_, input, pointer) => {
    expect(await adding(harness(), input)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });
});

describe('the name of a connection', () => {
  it('is refused with a conflict when the configuration of the runtime has a tool server of that name', async () => {
    expect(await adding(harness(), { ...notes, name: 'wiki' })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
      detail: "The runtime's configuration sets up a tool server named wiki, so a connection cannot take that name",
    });
  });

  it('is refused while another connection of the org has it, and taken again once that one is removed', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    const again = await adding(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(again).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
      detail: 'There is already a connection notes in this org',
    });
    expect(await adding(h, notes)).toMatchObject({ status: 'succeeded' });
  });
});

describe('the description of adding a connection', () => {
  it("opens with a person's account at a service, by a provider search lists or a server given by hand, says that once approved the connection's tools serve the org's playbooks, says to ask in one consent for what the runs and the setting up take, with more, says an MCP server given by hand says how it authenticates and a secret given by hand how its key is made, keeps the page the person finishes on, and ends with what the call does not grant", () => {
    expect(operationNamed(harness().operations, 'add_connection').registration.description).toBe(
      [
        "Starts connecting a person's account at a service, by the name of a provider that search lists, or a server given by hand as name, type, entry and credential.",
        "Once approved, the connection's tools serve the org's playbooks.",
        'Work out first what the runs will do at the service and what must exist there, and ask for the access both take; the guide connect-a-service says how.',
        'With more, a group the provider offers beyond its first consent, the page asks its scopes too.',
        'An MCP server given by hand says how it authenticates: leave its credential out unless the answer says it names none, and a secret takes instructions and key_page.',
        "It answers pending with a link to Studio's page, where the person approves it within 24 hours.",
        'Nothing is granted by this call and no credential passes through it.',
      ].join(' '),
    );
  });
});

describe('the permission to add a connection', () => {
  it('is org:write', async () => {
    expect(await adding(harness(), crm, acmeReader)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('the policy of the runtime, of who may add', () => {
  it('refuses every addition where people may not add connections', async () => {
    const h = harness({ policy: connectionPolicyOf({ people_may_add: false }) });

    expect(await adding(h, crm)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: anyWords,
    });
  });
});

describe('the policy of the runtime, of the hosts', () => {
  it('refuses a host no pattern allows, the hosts of an HTTP API each, and takes a host under a *. pattern', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['*.example.com', 'billing.example.com'] }) });
    const elsewhere = { ...billing, entry: { ...billing.entry, base_url: 'https://api.billing.example.org' } };
    const documentAlone = { ...billing, name: 'billing-document', entry: { document: billing.entry.document } };
    const apex = { ...notes, entry: { url: 'https://example.com/mcp' } };

    expect(await statusesOf(h, [crm, billing, elsewhere, apex, documentAlone])).toEqual([
      'succeeded',
      'succeeded',
      'rejected',
      'rejected',
      'succeeded',
    ]);
    expect(await adding(h, { ...elsewhere, name: 'elsewhere' })).toMatchObject({
      reason: 'forbidden',
      detail: anyWords,
    });
  });

  it('refuses the issuer of client credentials where no pattern allows it, since the client secret goes there', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['*.example.com'] }) });
    const issuedElsewhere = { ...billing, credential: { ...billing.credential, issuer: 'https://login.example.org' } };

    expect(await adding(h, issuedElsewhere)).toMatchObject({
      reason: 'forbidden',
      detail: anyWords,
    });
  });

  it('says when it allows no host', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: [] }) });

    expect(await adding(h, notes)).toMatchObject({
      detail: 'A connection may not reach the host notes.example.com on this runtime, which allows no host',
    });
  });
});

describe('the policy of the runtime, of the variables a reference names', () => {
  it('takes a reference to a variable it lists, and refuses one it does not, or every one where it lists none', async () => {
    const listing = harness({ policy: connectionPolicyOf({ variables: ['NOTES_API_KEY', 'WIKI_TOKEN'] }) });

    expect(await adding(listing, naming('NOTES_API_KEY'))).toMatchObject({ status: 'succeeded' });
    expect(await adding(listing, { ...naming('CRM_API_KEY'), name: 'crm-key' })).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: anyWords,
    });
    expect(await adding(harness(), naming('NOTES_API_KEY'))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: anyWords,
    });
  });
});

describe('the policy of the runtime, of the kinds of credential', () => {
  it('refuses a kind it does not list, and says when it lists none', async () => {
    const kinds = harness({ policy: connectionPolicyOf({ credential_kinds: ['none', 'reference'] }) });
    const none = harness({ policy: connectionPolicyOf({ credential_kinds: [] }) });

    expect(await adding(kinds, crm)).toMatchObject({
      reason: 'forbidden',
      detail: 'A connection may not take a secret credential on this runtime, which allows none and reference',
    });
    expect(await adding(kinds, notes)).toMatchObject({ status: 'succeeded' });
    expect(await adding(none, notes)).toMatchObject({
      detail: 'A connection may not take a none credential on this runtime, which allows no kind of credential',
    });
  });
});

describe('a connection added through the API', () => {
  it('carries no marks of its own, by hand or by a provider, refused at its entry with nothing recorded', async () => {
    const h = harness();

    const byHand = await adding(h, { ...notes, entry: { ...notes.entry, marks } });
    const byProvider = await adding(h, { provider: 'tracker', placeholders: { site: 'acme' }, entry: { marks } });

    expect([byHand, byProvider]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
    ]);
    expect([issuesIn(byHand), issuesIn(byProvider)].map((issues) => issues.map(({ pointer }) => pointer))).toEqual([
      ['/entry/marks'],
      ['/entry/marks'],
    ]);
    expect(await h.facts()).toEqual([]);
  });
});

describe('the render target of the provider of a connection', () => {
  it('is answered by add_connection, list_connections and get_connection, and by none for a connection given by hand', async () => {
    const h = harness({ providers });
    const addingRendersShown = operationNamed(h.operations, 'add_connection');
    const addedByProvider = await h.call(addingRendersShown, ada, tracked);
    const addedByHand = await h.call(addingRendersShown, ada, unrendered);
    const { id } = await added(h, { ...tracked, name: 'more-tracking' });

    expect([addedByProvider, addedByHand]).toMatchObject([
      { status: 'succeeded', output: { renders: 'cards' } },
      { status: 'succeeded', output: withoutRenders() },
    ]);
    expect(await h.call(operationNamed(h.operations, 'list_connections'), acmeReader, {})).toMatchObject({
      output: {
        connections: [
          { name: 'more-tracking', renders: 'cards' },
          { name: 'notes' },
          { name: 'tracker', renders: 'cards' },
        ],
      },
    });
    expect(await h.call(operationNamed(h.operations, 'get_connection'), acmeReader, { id })).toMatchObject({
      output: { id, renders: 'cards' },
    });
  });

  it('is served with the connection, for the tools of its server to say', async () => {
    const h = harness({ providers });
    await added(h, tracked);
    const source = makeConnectionSource({
      registry: h.ledger.service,
      secrets: h.secrets,
      policy: connectionPolicyOf({}),
      variables: new Map(),
      modelProviders: [],
      providers,
      providerValues: new Map(),
      pages: harnessPages,
    });

    const listed = await Effect.runPromise(source.connectionsOf('acme'));

    expect(listed.map(({ serving }) => serving.renders)).toEqual(['cards']);
  });
});

describe("the link to Studio's page that adding a connection answers", () => {
  it("is the page connect of the Studio the runtime serves, under the runtime's own origin, naming the connection and its token alone, since that page knows its server and asks it for the org", async () => {
    const runtime = 'http://127.0.0.1:5555';
    const { id, url, token } = await added(harness({ pages: { studio: servedStudio, runtime: () => runtime } }), notes);

    const page = new URL(url);
    expect([page.origin, page.pathname, Object.fromEntries(page.searchParams)]).toEqual([
      runtime,
      '/studio/connect',
      { connection: id, token },
    ]);
  });

  it('is the page connect at the root of the Studio host the runtime names, naming the runtime and the org too, where it serves no Studio', async () => {
    const studio = { origin: 'https://studio.example.com', served: false };
    const runtime = 'https://runtime.example.com';
    const { id, url, token } = await added(harness({ pages: { studio, runtime: () => runtime } }), notes);

    const page = new URL(url);
    expect([page.origin, page.pathname, [...page.searchParams]]).toEqual([
      'https://studio.example.com',
      '/connect',
      [
        ['server', runtime],
        ['org', 'acme'],
        ['connection', id],
        ['token', token],
      ],
    ]);
  });
});

describe('listing the connections of an org', () => {
  it('answers them newest first, and the removed ones only when asked', async () => {
    const h = harness();
    await added(h, notes, { at: earlier });
    const { id } = await added(h, billing);
    await added(h, crm);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });
    const listing = operationNamed(h.operations, 'list_connections');

    const names = async (input: unknown) => namesIn(await h.call(listing, acmeReader, input));

    expect(await names({})).toEqual(['crm', 'notes']);
    expect(await names({ include_removed: true })).toEqual(['crm', 'billing', 'notes']);
  });

  it('is permitted by org:read and refused to a caller who may only read playbooks', async () => {
    const h = harness();

    const outcome = await h.call(operationNamed(h.operations, 'list_connections'), acmeViewer);

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });

  it('says whether the caller may manage its connections: one who may write the org may, one who may only read it may not', async () => {
    const h = harness();
    const listing = operationNamed(h.operations, 'list_connections');

    expect([await h.call(listing, ada), await h.call(listing, acmeReader)]).toMatchObject([
      { status: 'succeeded', output: { may_manage: true } },
      { status: 'succeeded', output: { may_manage: false } },
    ]);
  });
});

const [trackerKey] = tracker.credentials;

function trackerOf(...ways: readonly unknown[]) {
  return providerListOf(providerOf({ ...tracker, credentials: ways }));
}

async function actingRecorded(h: Harness, input: unknown) {
  const { output } = Schema.decodeUnknownSync(ActingSchema)(await adding(h, input));
  return output;
}

const ActingSchema = Schema.Struct({
  output: Schema.Struct({
    permissions: Schema.NullOr(Schema.String),
    account_type: Schema.NullOr(Schema.String),
    credential: Schema.Record(Schema.String, Schema.Unknown),
  }),
});

const ofTracker = { provider: 'tracker', placeholders: { site: 'acme' } } as const;

describe('what an addition records the connection acts as, answered beside its credential', () => {
  it.each([
    [
      'takes an account, as personal',
      trackerOf({ ...trackerKey, account_types: ['personal'] }),
      'delegated',
      'personal',
    ],
    [
      'takes a service account alone, as one',
      trackerOf({ ...trackerKey, account_types: ['service'] }),
      'delegated',
      'service',
    ],
    ['acts as the app', trackerOf({ ...trackerKey, permissions: 'application' }), 'application', null],
  ] as const)('of a provider whose way %s', async (_case, offered, permissions, accountType) => {
    const answered = await actingRecorded(harness({ providers: offered }), ofTracker);

    expect([answered.permissions, answered.account_type, Object.hasOwn(answered.credential, 'permissions')]).toEqual([
      permissions,
      accountType,
      false,
    ]);
  });

  it.each([
    ['a key, as a personal account', crm, 'delegated', 'personal'],
    ['client credentials, as the app', billing, 'application', null],
    ['no credential, as nothing', notes, null, null],
  ] as const)('given by hand: %s', async (_case, input, permissions, accountType) => {
    const answered = await actingRecorded(harness(), input);

    expect([answered.permissions, answered.account_type]).toEqual([permissions, accountType]);
  });
});

describe('reading one connection', () => {
  it('answers its record, and an id the org does not have as not found', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const getting = operationNamed(h.operations, 'get_connection');

    expect(await h.call(getting, acmeReader, { id })).toMatchObject({
      status: 'succeeded',
      output: { id, name: 'notes', status: 'pending', credential: { kind: 'none' } },
    });
    expect(await h.call(getting, acmeReader, { id: 'nowhere' })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no connection nowhere in this org',
    });
  });
});
