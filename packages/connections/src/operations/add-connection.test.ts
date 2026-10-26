import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, adding, billing, crm, issuesIn, notes, statusesOf } from '../testing/additions.ts';
import { acmeReader, ada, harness, operationNamed } from '../testing/harness.ts';

describe('the answer to adding a connection', () => {
  it('is the connection pending, added by the caller, and the time its link expires, ten minutes on', async () => {
    expect(await adding(harness(), crm)).toMatchObject({
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
        connect: { expires_at: '2026-10-15T14:10:00.000Z' },
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
      expires_at: '2026-10-15T14:10:00.000Z',
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
  it("opens with a person's account at a service, by a provider search lists or a server given by hand, claims a service a playbook will use whatever connector the agent has, keeps the page the person finishes on, and ends with what the call does not grant", () => {
    expect(operationNamed(harness().operations, 'add_connection').registration.description).toBe(
      [
        "Starts connecting a person's account at a service, by the name of a provider that search lists, or a server given by hand as name, type, entry and credential.",
        'A service a playbook will use is connected here, whatever connector the agent has of its own for it.',
        "It answers pending with a link to Studio's page, where the person approves it within ten minutes.",
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
      detail: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
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
      detail:
        'A connection may not reach the host api.billing.example.org on this runtime, which allows *.example.com and billing.example.com',
    });
  });

  it('refuses the issuer of client credentials where no pattern allows it, since the client secret goes there', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['*.example.com'] }) });
    const issuedElsewhere = { ...billing, credential: { ...billing.credential, issuer: 'https://login.example.org' } };

    expect(await adding(h, issuedElsewhere)).toMatchObject({
      reason: 'forbidden',
      detail: 'A connection may not reach the host login.example.org on this runtime, which allows *.example.com',
    });
  });

  it('says when it allows no host', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: [] }) });

    expect(await adding(h, notes)).toMatchObject({
      detail: 'A connection may not reach the host notes.example.com on this runtime, which allows no host',
    });
  });
});

function naming(variable: string) {
  return { ...notes, credential: { kind: 'reference', variable, name: 'Authorization', in: 'header' } };
}

describe('the policy of the runtime, of the variables a reference names', () => {
  it('takes a reference to a variable it lists, and refuses one it does not, or every one where it lists none', async () => {
    const listing = harness({ policy: connectionPolicyOf({ variables: ['NOTES_API_KEY', 'WIKI_TOKEN'] }) });

    expect(await adding(listing, naming('NOTES_API_KEY'))).toMatchObject({ status: 'succeeded' });
    expect(await adding(listing, { ...naming('CRM_API_KEY'), name: 'crm-key' })).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail:
        'A reference may name only a variable the operator lists in connections.variables, which are NOTES_API_KEY and WIKI_TOKEN, and CRM_API_KEY is not one of them',
    });
    expect(await adding(harness(), naming('NOTES_API_KEY'))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail:
        'A reference may name only a variable the operator lists in connections.variables, and this runtime lists none',
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
