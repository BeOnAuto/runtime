import { providersOf, regions, tracker } from '@on.auto/providers/testing';
import { shippedDocumentOf } from '@on.auto/tool-servers';
import { fakeApiDocument } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, adding, issuesIn } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';

const acmeTracker = { provider: 'tracker', placeholders: { site: 'acme' } };

const keyed = {
  ...tracker,
  name: 'keyed',
  url: 'https://keyed.example.com/mcp',
  headers: { 'X-Api-Key': '{key_id}' },
  placeholders: { key_id: { description: 'The id of your key', pattern: '^[a-z0-9]{4,32}$', example: 'acme' } },
  credentials: [{ kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer$' }],
};

const keyedHeader = { ...keyed, name: 'keyed-header', credentials: [{ kind: 'none' }] };

const notesApi = {
  name: 'notes-api',
  title: 'Notes',
  description: 'Read notes.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'documents/notes-api.openapi.json',
  base_url: 'https://api.notes.example.org/v1',
  credentials: [{ kind: 'none' }],
};

const notesDocument = new TextEncoder().encode(JSON.stringify(fakeApiDocument('3.1', notesApi.base_url)));

const notesShipped = new Map([[notesApi.document, shippedDocumentOf(notesDocument)]]);

const openai = { ...tracker, name: 'openai', url: 'https://openai-tools.example.com/mcp', placeholders: {} };

describe('a connection added by a provider', () => {
  it('is the provider resolved, recorded with the provider and the values given, and pending with its link', async () => {
    const h = harness();

    expect(await adding(h, acmeTracker)).toMatchObject({
      status: 'succeeded',
      output: {
        name: 'tracker',
        type: 'mcp',
        provider: 'tracker',
        placeholders: { site: 'acme' },
        entry: { url: 'https://acme.tracker.example.com/mcp' },
        credential: { kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' },
        status: 'pending',
        connect: { expires_at: '2026-10-16T14:00:00.000Z' },
      },
    });
    expect((await h.facts())[0]?.data).toMatchObject({
      name: 'tracker',
      server_type: 'mcp',
      provider: 'tracker',
      placeholders: { site: 'acme' },
      entry: { url: 'https://acme.tracker.example.com/mcp' },
    });
  });

  it('takes the name, the way and what is per connection from the caller', async () => {
    const given = {
      ...acmeTracker,
      name: 'acme-issues',
      entry: { playbooks: ['support'], allowed: ['search'], record_content: false },
      credential: { kind: 'none' },
    };

    expect(await adding(harness(), given)).toMatchObject({
      output: {
        name: 'acme-issues',
        entry: {
          url: 'https://acme.tracker.example.com/mcp',
          playbooks: ['support'],
          allowed: ['search'],
          record_content: false,
        },
        credential: { kind: 'none' },
      },
    });
  });
});

describe('a connection added by hand', () => {
  it('answers a server given by hand with no provider and no placeholders', async () => {
    const { id } = await added(harness(), {
      name: 'notes',
      type: 'mcp',
      entry: { url: 'https://notes.example.com/mcp' },
      credential: { kind: 'none' },
    });

    expect(id).toMatch(/^[\da-f-]{36}$/u);
  });
});

describe('the input of a connection added by a provider', () => {
  it('refuses the server and every field of the credential but its kind and its scope, and the client id the person gives on the page', async () => {
    const given = {
      ...acmeTracker,
      type: 'mcp',
      entry: { url: 'https://elsewhere.example.com/mcp', headers: { 'X-Tenant': 'acme' } },
      credential: { kind: 'secret', name: 'X-Key', in: 'header', client_id: 'acme' },
    };

    expect(issuesIn(await adding(harness(), given))).toEqual([
      { pointer: '/type', detail: 'Expected no type: the provider gives it' },
      { pointer: '/entry/url', detail: 'Expected no url: the provider gives the server' },
      { pointer: '/entry/headers', detail: 'Expected no headers: the provider gives the server' },
      {
        pointer: '/credential/name',
        detail: 'Expected no name: the provider gives the credential but its kind and its scope',
      },
      {
        pointer: '/credential/in',
        detail: 'Expected no in: the provider gives the credential but its kind and its scope',
      },
      { pointer: '/credential/client_id', detail: 'Expected no client_id: the person gives the client id on the page' },
    ]);
  });

  it('without a provider, takes the server by hand and refuses placeholders', async () => {
    expect(issuesIn(await adding(harness(), { placeholders: { site: 'acme' } }))).toEqual([
      { pointer: '/name', detail: 'Expected name, which a server given by hand takes, or provider' },
      { pointer: '/type', detail: 'Expected type, which a server given by hand takes, or provider' },
      { pointer: '/entry', detail: 'Expected entry, which a server given by hand takes, or provider' },
      { pointer: '/credential', detail: 'Expected credential, which an HTTP API given by hand takes, or provider' },
      { pointer: '/placeholders', detail: 'Expected no placeholders without provider' },
    ]);
  });
});

describe('a provider a caller names', () => {
  it('is refused at /provider where the runtime has none of that name, and at the field written otherwise', async () => {
    const h = harness();

    expect(await adding(h, { provider: 'crm' })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The connection cannot be added as it is given',
      issues: [
        {
          pointer: '/provider',
          detail: 'There is no provider named crm here; search lists the providers a person may connect',
        },
      ],
    });
    expect(
      issuesIn(
        await adding(h, { provider: 'regions', placeholders: { region: 'apac' }, credential: { kind: 'none' } }),
      ),
    ).toEqual([
      { pointer: '/placeholders/region', detail: 'Expected one of na or eu' },
      { pointer: '/placeholders/account', detail: 'Expected account: The id of your account' },
      { pointer: '/credential/kind', detail: 'The provider regions takes no none credential; it takes secret' },
    ]);
  });
});

describe('a provider whose addition the checks refuse', () => {
  it('is refused at /provider for what the checks of an addition find in what it resolved, at /name for a name given', async () => {
    const h = harness({ providers: providersOf(keyed, keyedHeader, openai, regions) });

    expect([
      issuesIn(await adding(h, { provider: 'keyed', placeholders: { key_id: 'acme' } })),
      issuesIn(await adding(h, { provider: 'keyed-header', placeholders: { key_id: 'acme' } })),
      issuesIn(await adding(h, { provider: 'openai' })),
      issuesIn(await adding(h, { provider: 'openai', name: 'Tools' })),
      issuesIn(await adding(h, { provider: 'openai', name: 'tools', entry: { playbooks: ['Sales'] } })),
    ]).toEqual([
      [
        {
          pointer: '/provider',
          detail: 'Expected a scheme without $, which the reading of the entry takes for a reference or an escape',
        },
      ],
      [
        {
          pointer: '/provider',
          detail:
            "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens",
        },
      ],
      [
        {
          pointer: '/provider',
          detail: 'The name of a model provider or gateway, which a reasoning function could not tell apart from it',
        },
      ],
      [
        {
          pointer: '/name',
          detail: 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
        },
      ],
      [{ pointer: '/entry/playbooks/0', detail: 'Expected a playbook id' }],
    ]);
  });
});

describe('the rules a connection added by a provider passes', () => {
  it('are those of a server given by hand: the hosts, the kinds and the names the file and the org hold', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['*.example.org'], credential_kinds: ['secret'] }),
    });

    expect([
      await adding(h, acmeTracker),
      await adding(harness({ policy: connectionPolicyOf({ credential_kinds: ['secret'] }) }), {
        ...acmeTracker,
        credential: { kind: 'none' },
      }),
      await adding(harness(), { ...acmeTracker, name: 'wiki' }),
    ]).toMatchObject([
      {
        reason: 'forbidden',
        detail:
          'A connection may not reach the host acme.tracker.example.com on this runtime, which allows *.example.org',
      },
      {
        reason: 'forbidden',
        detail: 'A connection may not take a none credential on this runtime, which allows secret',
      },
      { reason: 'conflict', kind: 'taken' },
    ]);
  });

  it('take the document beside the entries of a provider, which is no host, and judge the host its calls go to', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['*.example.org'] }),
      providers: { ...providersOf(notesApi), documents: notesShipped },
    });

    expect(await adding(h, { provider: 'notes-api' })).toMatchObject({
      status: 'succeeded',
      output: { type: 'openapi', entry: { document: 'documents/notes-api.openapi.json' }, status: 'pending' },
    });
  });

  it('say which provider could not be connected in the words of the refusal', async () => {
    expect(await adding(harness({ policy: connectionPolicyOf({ people_may_add: false }) }), acmeTracker)).toMatchObject(
      {
        reason: 'forbidden',
        detail: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
      },
    );
  });
});
