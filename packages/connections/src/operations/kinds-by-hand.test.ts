import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { failingAt, type ClientRegistration } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { adding, billing, issuesIn } from '../testing/additions.ts';
import { byHandAt, harnessByHand, refusedKind } from '../testing/by-hand.ts';
import { consentFake } from '../testing/consents.ts';
import { harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function consenting(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

async function serving(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp(options);
  closing.push(fake.close);
  return fake;
}

const signingIn: Partial<ClientRegistration> = { dynamicRegistration: true, requiredScopes: ['files.read'] };

const secret = { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer' };

function leftOutAt({ url }: Pick<FakeMcpServer, 'url'>, name = 'files') {
  return { name, type: 'mcp', entry: { url } };
}

function givenAt(fake: Pick<FakeMcpServer, 'url'>, credential: Readonly<Record<string, unknown>>, name = 'files') {
  return { ...leftOutAt(fake, name), credential };
}

function pingsHeardBy(fake: FakeMcpServer): number {
  return fake.heard().filter(({ method, path }) => method === 'POST' && path === '/mcp').length;
}

function takesConsentAt({ url, origin }: FakeMcpServer) {
  return refusedKind(
    `The server at ${url} takes consent at the authorization server ${origin}, which it names itself: leave the credential out, or give the kind authorization alone`,
  );
}

function namesNoWayAt({ url }: FakeMcpServer) {
  return [
    {
      pointer: '/credential',
      detail: `Expected credential: the server at ${url} names no way of its own to authenticate, since it names no authorization server; say how it takes its credential: a secret in a header, or none`,
    },
  ];
}

describe('an MCP server given by hand that names its authorization server', () => {
  it('is added with the way it names, the same record whether its credential is left out or of the kind authorization', async () => {
    const fake = await consenting(signingIn);
    const h = harnessByHand();
    const credential = { kind: 'authorization', issuer: fake.origin, clients: ['dynamic'], scope: 'files.read' };

    const outcomes = [await adding(h, leftOutAt(fake)), await adding(h, { ...byHandAt(fake), name: 'files-named' })];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { provider: null, status: 'pending', credential, connect: {} } },
      { status: 'succeeded', output: { provider: null, status: 'pending', credential, connect: {} } },
    ]);
    expect((await h.facts()).filter(({ type }) => type === 'connection_added')).toMatchObject([
      { data: { credential } },
      { data: { credential } },
    ]);
  });

  it('refuses a secret or none at the kind, naming the authorization server and saying to leave the credential out, after asking the server once and recording nothing', async () => {
    const fake = await consenting(signingIn);
    const h = harnessByHand();

    expect([
      issuesIn(await adding(h, givenAt(fake, secret))),
      issuesIn(await adding(h, givenAt(fake, { kind: 'none' }))),
    ]).toEqual([takesConsentAt(fake), takesConsentAt(fake)]);
    expect(pingsHeardBy(fake)).toBe(2);
    expect(await h.facts()).toEqual([]);
  });
});

describe('the other kinds given for an MCP server given by hand that names its authorization server', () => {
  it('take client credentials as they are given, since they take their token from an authorization server too', async () => {
    const fake = await consenting(signingIn);
    const credential = { kind: 'client_credentials', issuer: fake.origin, client_id: 'files' };

    expect(await adding(harnessByHand(), givenAt(fake, credential))).toMatchObject({
      status: 'succeeded',
      output: { credential },
    });
  });

  it('refuse a secret in the words of consent where the runtime cannot take the way the server names', async () => {
    const closed = await consenting();
    const malformed = await consenting({ dynamicRegistration: true, protectedScopes: ['files.read', ''] });
    const h = harnessByHand();

    expect([
      issuesIn(await adding(h, givenAt(closed, secret))),
      issuesIn(await adding(h, givenAt(malformed, secret))),
    ]).toEqual([
      refusedKind(
        `The authorization server ${closed.origin} of the server at ${closed.url} registers no clients, so this runtime cannot connect it by consent: it takes a client registered dynamically or named by a metadata document, and offers neither`,
      ),
      refusedKind(
        `The server at ${malformed.url} asks a scope written with characters a scope does not hold, so this runtime cannot connect it by consent`,
      ),
    ]);
  });
});

describe('an MCP server given by hand that names no way of its own', () => {
  it('keeps the kind given, where it asks no token, answers with a challenge that names no metadata and a client error at its well-known paths, or names the metadata of another resource', async () => {
    const open = await serving();
    const bare = await serving({ bearer: 'files-token' });
    const elsewhere = await consenting({ protectedResource: 'https://elsewhere.example.com/mcp' });
    const h = harnessByHand();

    expect([
      await adding(h, givenAt(open, { kind: 'none' }, 'open')),
      await adding(h, givenAt(bare, secret, 'bare')),
      await adding(h, givenAt(elsewhere, secret, 'elsewhere')),
    ]).toMatchObject([
      { status: 'succeeded', output: { credential: { kind: 'none' } } },
      { status: 'succeeded', output: { credential: secret } },
      { status: 'succeeded', output: { credential: secret } },
    ]);
    expect(bare.heard().map(({ path }) => path)).toContain('/.well-known/oauth-protected-resource');
  });

  it('refuses a credential left out at the credential, in words that say to say how it takes one', async () => {
    const open = await serving();
    const bare = await serving({ bearer: 'files-token' });
    const h = harnessByHand();

    expect([issuesIn(await adding(h, leftOutAt(open))), issuesIn(await adding(h, leftOutAt(bare)))]).toEqual([
      namesNoWayAt(open),
      namesNoWayAt(bare),
    ]);
    expect(await h.facts()).toEqual([]);
  });

  it('refuses a credential left out at the kind, in the words of consent, where its metadata is another resource’s', async () => {
    const elsewhere = await consenting({ protectedResource: 'https://elsewhere.example.com/mcp' });

    expect(issuesIn(await adding(harnessByHand(), leftOutAt(elsewhere)))).toEqual(
      refusedKind(
        `The server at ${elsewhere.url} names https://elsewhere.example.com/mcp as the resource it protects, which is not its own address, so this runtime cannot connect it by consent`,
      ),
    );
  });
});

describe('an MCP server given by hand that does not answer how it authenticates', () => {
  it('is unavailable whatever the kind given, recording nothing', async () => {
    const silent = await serving();
    silent.holdNextOf('ping');
    silent.holdNextOf('ping');
    silent.holdNextOf('ping');
    const h = harnessByHand({ consenting: { requestMs: 50 } });
    const unavailable = {
      status: 'rejected',
      reason: 'unavailable',
      detail: `The server at ${silent.url} did not answer as an MCP server does; try again in a moment`,
    };

    expect([
      await adding(h, leftOutAt(silent)),
      await adding(h, givenAt(silent, secret)),
      await adding(h, givenAt(silent, { kind: 'none' })),
    ]).toEqual([unavailable, unavailable, unavailable]);
    expect(await h.facts()).toEqual([]);
  });

  it('is unavailable whatever the kind given, where its well-known paths answer a server error, whether its challenge names its metadata or none', async () => {
    const naming = await consenting(signingIn);
    const bare = await serving({ bearer: 'files-token' });
    const h = harnessByHand({ consenting: { fetch: failingAt('/.well-known/oauth-protected-resource/mcp') } });

    expect([
      await adding(h, givenAt(naming, secret)),
      await adding(h, leftOutAt(naming)),
      await adding(h, givenAt(bare, secret)),
      await adding(h, leftOutAt(bare)),
    ]).toEqual(
      [naming, naming, bare, bare].map(({ url }) => ({
        status: 'rejected',
        reason: 'unavailable',
        detail: `The server at ${url} did not answer as an MCP server does; try again in a moment`,
      })),
    );
    expect(await h.facts()).toEqual([]);
  });
});

describe('an MCP server given by hand on a host the rules refuse once it is asked', () => {
  it('is forbidden in the words of the rule, whatever the kind given, where its host resolves to an address the rules refuse', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['*.example.com'] }),
      resolve: () => Promise.resolve(['10.1.2.3']),
    });
    const files = { url: 'https://files.example.com/mcp' };

    expect([await adding(h, givenAt(files, secret)), await adding(h, leftOutAt(files))]).toEqual(
      Array.from({ length: 2 }, () => ({
        status: 'rejected',
        reason: 'forbidden',
        detail: 'A connection may not reach the host files.example.com, which resolves to a private address',
      })),
    );
    expect(await h.facts()).toEqual([]);
  });
});

describe('the rules over a credential left out', () => {
  it('judge it as the kind authorization, the one kind it is recorded as, before the server is asked anything', async () => {
    const fake = await consenting(signingIn);
    const h = harnessByHand({
      policy: connectionPolicyOf({ allowed_hosts: ['127.0.0.1'], credential_kinds: ['secret'] }),
    });

    expect(await adding(h, leftOutAt(fake))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'A connection may not take an authorization credential on this runtime, which allows secret',
    });
    expect(fake.heard()).toEqual([]);
  });
});

describe('an HTTP API given by hand', () => {
  it('takes its credential, since its document says nothing of how it authenticates', async () => {
    const withoutCredential = { name: billing.name, type: billing.type, entry: billing.entry };

    expect(issuesIn(await adding(harnessByHand(), withoutCredential))).toEqual([
      { pointer: '/credential', detail: 'Expected credential, which an HTTP API given by hand takes, or provider' },
    ]);
  });
});
