import { describe, expect, it } from 'vitest';

import { adding, billing, crm, issuesIn, notes, statusesOf } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';
import { loopbackPolicyOf } from '../testing/loopback-policy.ts';

const refusedCredentials = [
  ['a kind of credential there is not', { kind: 'consent' }, '/credential/kind'],
  ['a field of another kind', { kind: 'none', name: 'CRM_API_KEY' }, '/credential/name'],
  [
    'a reference without its variable',
    { kind: 'reference', name: 'Authorization', in: 'header' },
    '/credential/variable',
  ],
  [
    'a reference to no variable',
    { kind: 'reference', variable: 'crm-api-key', name: 'Authorization', in: 'header' },
    '/credential/variable',
  ],
  [
    'a reference in no header',
    { kind: 'reference', variable: 'CRM_API_KEY', name: 'a header', in: 'header' },
    '/credential/name',
  ],
  ['a secret that says not where it is sent', { kind: 'secret', name: 'Authorization' }, '/credential/in'],
  ['a secret in a query parameter of an mcp server', { kind: 'secret', name: 'key', in: 'query' }, '/credential/in'],
  ['a secret in a header the entry sends', { kind: 'secret', name: 'x-tenant', in: 'header' }, '/credential/name'],
  ['a secret in no header', { kind: 'secret', name: 'a header', in: 'header' }, '/credential/name'],
  [
    'a scheme that holds a space',
    { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer token' },
    '/credential/scheme',
  ],
  [
    'client credentials of an issuer that is not pinned',
    { kind: 'client_credentials', issuer: 'http://auth.example.com', client_id: 'acme' },
    '/credential/issuer',
  ],
] as const;

describe('a credential that cannot be taken', () => {
  it.each(refusedCredentials)('is refused for %s', async (_, credential, pointer) => {
    expect(await adding(harness(), { ...crm, credential })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });

  it('names the field a kind takes and lacks, and the field it does not take', async () => {
    const credentials: readonly Readonly<Record<string, string>>[] = [
      { kind: 'reference', name: 'Authorization', in: 'header' },
      { kind: 'none', in: 'header' },
      { kind: 'client_credentials', issuer: 'https://auth.example.com', client_id: 'acme', name: 'CRM_API_KEY' },
      { kind: 'secret', name: 'Authorization', in: 'header', issuer: 'https://auth.example.com' },
    ];

    const refused = await Promise.all(
      credentials.map(async (credential) => issuesIn(await adding(harness(), { ...crm, credential }))),
    );

    expect(refused).toEqual([
      [{ pointer: '/credential/variable', detail: 'Expected variable, which a reference credential takes' }],
      [{ pointer: '/credential/in', detail: 'Expected no in: a none credential takes no other field' }],
      [
        {
          pointer: '/credential/name',
          detail: 'Expected no name: a client_credentials credential takes issuer, client_id, and scope',
        },
      ],
      [{ pointer: '/credential/issuer', detail: 'Expected no issuer: a secret credential takes name, in, and scheme' }],
    ]);
  });
});

function withScheme(scheme: string, credential: Readonly<Record<string, string>> = {}) {
  return { kind: 'secret', name: 'Authorization', in: 'header', scheme, ...credential };
}

describe('the scheme of a credential sent in a header', () => {
  it('is taken by a secret and a reference, and answered with the credential', async () => {
    const h = harness({ policy: loopbackPolicyOf({ variables: ['CRM_API_KEY'] }) });
    const reference = withScheme('Token', { kind: 'reference', variable: 'CRM_API_KEY' });

    const answers = [
      await adding(h, { ...crm, credential: withScheme('Bearer') }),
      await adding(h, { ...crm, name: 'crm-key', credential: reference }),
    ];

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { credential: withScheme('Bearer') } },
      { status: 'succeeded', output: { credential: reference } },
    ]);
  });

  it('is refused in its own words where nothing is sent in a header, and where it holds what a scheme cannot', async () => {
    const api = { ...billing, credential: withScheme('Bearer', { name: 'key', in: 'query' }) };
    const additions: readonly unknown[] = [
      { ...crm, credential: { kind: 'none', scheme: 'Bearer' } },
      { ...billing, credential: { ...billing.credential, scheme: 'Bearer' } },
      api,
      { ...api, credential: withScheme('Bearer', { name: 'apiKeyAuth', in: 'security' }) },
      { ...crm, credential: withScheme('Bearer$') },
      { ...crm, credential: withScheme('Bearer:') },
    ];

    const refused = await Promise.all(additions.map(async (addition) => issuesIn(await adding(harness(), addition))));

    expect(refused).toEqual(
      [
        'Expected no scheme: a none credential places no value in a header for the runtime to write a scheme before',
        'Expected no scheme: a client_credentials credential places no value in a header for the runtime to write a scheme before',
        'Expected no scheme, which goes before a value sent in a header: this credential is sent in a query parameter',
        'Expected no scheme, which goes before a value sent in a header: this credential is sent in a security scheme of the document, which says how the value is sent',
        'Expected a scheme without $, which the reading of the entry takes for a reference or an escape',
        'Expected a scheme of the characters a header name holds, such as Bearer',
      ].map((detail) => [{ pointer: '/credential/scheme', detail }]),
    );
  });
});

const withoutTheClient = { kind: 'client_credentials', issuer: billing.credential.issuer };

describe('client credentials without their client id', () => {
  it('are taken, pending, and answered without it, since the person gives it on the page with the secret', async () => {
    expect(await adding(harness(), { ...billing, credential: withoutTheClient })).toMatchObject({
      status: 'succeeded',
      output: { status: 'pending', credential: withoutTheClient },
    });
  });

  it('are read as the entry will be read once it is given, so an entry its reading refuses is refused', async () => {
    const unaddressed = { name: 'billing', type: 'mcp', entry: {}, credential: withoutTheClient };

    expect(await adding(harness(), unaddressed)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/entry' }],
    });
  });
});

describe('a client id that looks like a credential', () => {
  it('is refused at the field the agent wrote, saying that the person gives the secret on the page', async () => {
    const credential = { ...billing.credential, client_id: 'sk-live-0123456789abcdef' };

    expect(issuesIn(await adding(harness(), { ...billing, credential }))).toEqual([
      {
        pointer: '/credential/client_id',
        detail:
          'Looks like a credential, which a client id never is: leave the secret out, and the person gives it on the page the link opens',
      },
    ]);
  });
});

function inHeader(name: string) {
  return { kind: 'secret', name, in: 'header' } as const;
}

describe('a secret in a header', () => {
  it('is refused in a header the runtime sends itself, and taken in Authorization', async () => {
    const connections: readonly unknown[] = [
      { ...crm, credential: inHeader('Mcp-Session-Id') },
      { ...crm, credential: inHeader('Host') },
      { ...billing, credential: inHeader('Content-Type') },
      { ...billing, credential: inHeader('content-length') },
    ];

    const refused = await Promise.all(
      connections.map(async (connection: unknown) => issuesIn(await adding(harness(), connection))),
    );
    const statuses = await statusesOf(harness(), [
      { ...crm, credential: inHeader('Authorization') },
      { ...billing, credential: inHeader('Authorization') },
    ]);

    expect(refused).toEqual([
      [
        {
          pointer: '/credential/name',
          detail: 'A header the MCP client sets itself, so the credential cannot go in it',
        },
      ],
      [
        {
          pointer: '/credential/name',
          detail: 'A header the MCP client sets itself, so the credential cannot go in it',
        },
      ],
      [{ pointer: '/credential/name', detail: 'A header the runtime sets itself, so the credential cannot go in it' }],
      [{ pointer: '/credential/name', detail: 'A header the runtime sets itself, so the credential cannot go in it' }],
    ]);
    expect(statuses).toEqual(['succeeded', 'succeeded']);
  });
});

describe("a header that opens a cloud's instance metadata service", () => {
  it("is refused in a header that opens a cloud's instance metadata service, to an mcp server and an HTTP API alike", async () => {
    const refused = await Promise.all(
      [
        { ...crm, credential: inHeader('Metadata-Flavor') },
        { ...billing, credential: inHeader('x-aws-ec2-metadata-token') },
      ].map(async (connection: unknown) => issuesIn(await adding(harness(), connection))),
    );

    expect(refused).toEqual(
      [0, 1].map(() => [
        {
          pointer: '/credential/name',
          detail:
            "A header that opens a cloud's instance metadata service, which no tool server is sent, so the credential cannot go in it",
        },
      ]),
    );
  });

  it("is refused where the entry sends a header that opens a cloud's instance metadata service", async () => {
    const opening = { ...notes, entry: { ...notes.entry, headers: { 'Metadata-Flavor': 'Google' } } };

    expect(issuesIn(await adding(harness(), opening))).toEqual([
      {
        pointer: '/entry/headers/Metadata-Flavor',
        detail: "A header that opens a cloud's instance metadata service, which no tool server is sent",
      },
    ]);
  });
});

describe('a secret of an HTTP API', () => {
  it('is taken in a header, a query parameter or a security scheme the entry leaves free', async () => {
    const api = { ...billing, entry: { ...billing.entry, query_params: { tenant: 'acme' } } };
    const sentAs = (name: string, credential: Readonly<Record<string, string>>) => ({
      ...api,
      name,
      credential: { kind: 'secret', ...credential },
    });

    const statuses = await statusesOf(harness(), [
      sentAs('billing-header', { name: 'X-Api-Key', in: 'header' }),
      sentAs('billing-key', { name: 'key', in: 'query' }),
      sentAs('billing-scheme', { name: 'apiKey', in: 'security' }),
      sentAs('billing-tenant', { name: 'Tenant', in: 'query' }),
    ]);

    expect(statuses).toEqual(['succeeded', 'succeeded', 'succeeded', 'rejected']);
  });
});
