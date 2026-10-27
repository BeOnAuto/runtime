import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { failingAt, type ClientRegistration } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { adding, issuesIn } from '../testing/additions.ts';
import { byHandAt, harnessByHand, refusedKind } from '../testing/by-hand.ts';
import { consentFake } from '../testing/consents.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

const givenBesideTheKind = {
  kind: 'authorization',
  variable: 'FILES_TOKEN',
  name: 'Authorization',
  in: 'header',
  scheme: 'Bearer',
  issuer: 'https://accounts.files.example.com',
  scope: 'files.read',
  client_id: 'files-client',
};

describe('a credential of consent given by hand', () => {
  it('takes its kind alone, every other field refused at its place, before the server is asked anything', async () => {
    const fake = await served({ dynamicRegistration: true });

    const outcome = await adding(harnessByHand(), { ...byHandAt(fake), credential: givenBesideTheKind });

    expect(issuesIn(outcome)).toEqual(
      ['variable', 'name', 'in', 'scheme', 'issuer', 'scope', 'client_id'].map((field) => ({
        pointer: `/credential/${field}`,
        detail: `Expected no ${field}: the server names its authorization server itself`,
      })),
    );
    expect(fake.heard()).toEqual([]);
  });

  it('is refused for an HTTP API, whose document names no authorization server', async () => {
    const api = {
      name: 'files-api',
      type: 'openapi',
      entry: { document: 'https://files.example.com/openapi.json' },
      credential: { kind: 'authorization' },
    };

    expect(issuesIn(await adding(harnessByHand(), api))).toEqual(
      refusedKind(
        'Expected another kind: an HTTP API given by hand takes no consent, since its document names no authorization server; name a provider, as search lists it, in provider',
      ),
    );
  });
});

describe('the rules of the runtime over a server given by hand that signs people in', () => {
  it('refuse it before the server is asked anything', async () => {
    const fake = await served({ dynamicRegistration: true });
    const closed = harnessByHand({ policy: connectionPolicyOf({ people_may_add: false }) });
    const unkind = harnessByHand({ policy: connectionPolicyOf({ credential_kinds: ['secret'] }) });

    expect([await adding(closed, byHandAt(fake)), await adding(unkind, byHandAt(fake))]).toMatchObject([
      { reason: 'forbidden' },
      { reason: 'forbidden' },
    ]);
    expect(fake.heard()).toEqual([]);
  });

  it('forbid it in the words of the rule where an endpoint of its authorization server is on a host they refuse', async () => {
    const fake = await served({ dynamicRegistration: true, endpointHost: 'localhost' });
    const h = harnessByHand({ policy: connectionPolicyOf({ allowed_hosts: ['127.0.0.1'] }) });

    expect(await adding(h, byHandAt(fake))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'A connection may not reach the host localhost on this runtime, which allows 127.0.0.1',
    });
  });
});

describe('a server given by hand whose way of consent the runtime cannot take for what the server says', () => {
  it('is refused at the kind, in words that name the server, recording nothing', async () => {
    const silent = await served({ publishesMetadata: false });
    const elsewhere = await served({ protectedResource: 'https://elsewhere.example.com/mcp' });
    const malformed = await served({ dynamicRegistration: true, protectedScopes: ['files.read', ''] });
    const h = harnessByHand();

    expect([
      issuesIn(await adding(h, byHandAt(silent))),
      issuesIn(await adding(h, byHandAt(elsewhere))),
      issuesIn(await adding(h, byHandAt(malformed))),
    ]).toEqual([
      refusedKind(
        `The server at ${silent.url} names no authorization server, so it offers no consent; give the credential it takes: a secret in a header, or none`,
      ),
      refusedKind(
        `The server at ${elsewhere.url} names https://elsewhere.example.com/mcp as the resource it protects, which is not its own address, so this runtime cannot connect it by consent`,
      ),
      refusedKind(
        `The server at ${malformed.url} asks a scope written with characters a scope does not hold, so this runtime cannot connect it by consent`,
      ),
    ]);
    expect(await h.facts()).toEqual([]);
  });
});

function atTheIssuer({ url }: FakeMcpServer, issuer: string, words: string) {
  return refusedKind(`The authorization server ${issuer} of the server at ${url} ${words}`);
}

describe('a server given by hand whose way of consent the runtime cannot take for what its issuer says', () => {
  it('is refused at the kind, in words that name the issuer and the server', async () => {
    const offHttps = await served({ authorizationServers: ['http://auth.example.com'] });
    const echoing = await served({ issuer: 'https://elsewhere.example.com' });
    const plain = await served({ dynamicRegistration: true, challengeMethods: ['plain'] });
    const plaintext = await served({ dynamicRegistration: true, endpointHost: 'endpoints.example.com' });
    const closed = await served();
    const h = harnessByHand();

    expect([
      issuesIn(await adding(h, byHandAt(offHttps))),
      issuesIn(await adding(h, byHandAt(echoing))),
      issuesIn(await adding(h, byHandAt(plain))),
      issuesIn(await adding(h, byHandAt(plaintext))),
      issuesIn(await adding(h, byHandAt(closed))),
    ]).toEqual([
      atTheIssuer(
        offHttps,
        'http://auth.example.com',
        'publishes no metadata that can be read, so this runtime cannot connect it by consent',
      ),
      atTheIssuer(
        echoing,
        echoing.origin,
        'names https://elsewhere.example.com as its issuer in its own metadata, so this runtime cannot connect it by consent',
      ),
      atTheIssuer(
        plain,
        plain.origin,
        'does not take the authorization code with an S256 challenge, so this runtime cannot connect it by consent',
      ),
      atTheIssuer(
        plaintext,
        plaintext.origin,
        `names http://endpoints.example.com:${new URL(plaintext.origin).port}/authorize as an endpoint, which is neither https nor on a loopback address, so this runtime cannot connect it by consent`,
      ),
      atTheIssuer(
        closed,
        closed.origin,
        'registers no clients, so this runtime cannot connect it by consent: it takes a client registered dynamically or named by a metadata document, and offers neither',
      ),
    ]);
  });
});

describe('a server given by hand that does not answer', () => {
  it('is unavailable, in words that name the server, where the server or its authorization server does not answer', async () => {
    const silent = await serveFakeMcp();
    closing.push(silent.close);
    silent.holdNextOf('ping');
    const failing = await served({ dynamicRegistration: true });
    const bounded = harnessByHand({ consenting: { requestMs: 50 } });
    const unread = harnessByHand({ consenting: { fetch: failingAt('/.well-known/oauth-authorization-server') } });

    expect([await adding(bounded, byHandAt(silent)), await adding(unread, byHandAt(failing))]).toEqual([
      {
        status: 'rejected',
        reason: 'unavailable',
        detail: `The server at ${silent.url} did not answer as an MCP server does; try again in a moment`,
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        detail: `The authorization server ${failing.origin} of the server at ${failing.url} did not answer as an authorization server does; try again in a moment`,
      },
    ]);
  });
});
