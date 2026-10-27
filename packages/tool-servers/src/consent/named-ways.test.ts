import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect, Function } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { consentClientWith, everyHost, type ClientRegistration } from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import { serveFakeMcp, servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import type { ConsentClientOptions, WayAsked } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

function askedAt({ url }: Pick<FakeMcpServer, 'url'>, reaches = everyHost): WayAsked {
  return { url, reaches };
}

function named(asked: WayAsked, options: Partial<ConsentClientOptions> = {}) {
  return Effect.runPromise(consentClientWith(options).namedWay(asked));
}

function refused(asked: WayAsked, options: Partial<ConsentClientOptions> = {}) {
  return Effect.runPromise(Effect.flip(consentClientWith(options).namedWay(asked)));
}

const publicUrl = 'https://runtime.example.com';

const unpinned = 'http://auth.example.com';

const rule = 'A connection may not reach the host localhost on this runtime, which allows 127.0.0.1';

function onLoopbackAlone(url: string): string | undefined {
  return new URL(url).hostname === 'localhost' ? rule : undefined;
}

function refusingEveryHost(): string {
  return rule;
}

interface Fetched {
  readonly fetch: FetchLike;
  readonly asked: () => readonly string[];
}

function recordedFetch(answeredHere: (address: string) => Response | undefined = Function.constUndefined): Fetched {
  const asked: string[] = [];
  return {
    fetch: (...[address, init]: readonly [unknown, unknown?]) => {
      asked.push(String(address));
      const here = answeredHere(String(address));
      return here === undefined ? globalThis.fetch(String(address), Object.assign({}, init)) : Promise.resolve(here);
    },
    asked: () => [...asked],
  };
}

function challengedWith(server: string, challenge: string): Fetched {
  return recordedFetch((address) =>
    address === server ? new Response(null, { status: 401, headers: { 'www-authenticate': challenge } }) : undefined,
  );
}

function offTheLoopbackOf(fetched: Fetched): readonly string[] {
  return fetched.asked().filter((address) => address.startsWith(unpinned));
}

function failingAt(path: string): FetchLike {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).includes(path)
      ? Promise.resolve(new Response('failing', { status: 500 }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

describe('the way of consent a server given by hand names', () => {
  it('is the issuer its metadata names, the client the runtime registers there dynamically, and the scope its challenge asks, registering nothing yet', async () => {
    const fake = await served({ dynamicRegistration: true, requiredScopes: ['files.read', 'files.write'] });

    expect(await named(askedAt(fake))).toEqual({
      issuer: fake.origin,
      clients: ['dynamic'],
      scope: 'files.read files.write',
    });
    expect(fake.heard().map(({ path }) => path)).not.toContain('/register');
  });

  it('takes the metadata document first where the issuer advertises it and the public address is https, and dynamic registration alone otherwise', async () => {
    const both = await served({ clientMetadataDocuments: true, dynamicRegistration: true });
    const documenting = await served({ clientMetadataDocuments: true });

    expect([
      (await named(askedAt(both), { publicUrl })).clients,
      (await named(askedAt(both))).clients,
      (await named(askedAt(documenting), { publicUrl })).clients,
    ]).toEqual([['metadata_document', 'dynamic'], ['dynamic'], ['metadata_document']]);
  });

  it('asks the scopes its protected resource metadata lists where its challenge names none, and none where neither does', async () => {
    const listing = await served({ dynamicRegistration: true, protectedScopes: ['files.read', 'offline_access'] });
    const silent = await served({ dynamicRegistration: true });

    expect([(await named(askedAt(listing))).scope, (await named(askedAt(silent))).scope]).toEqual([
      'files.read offline_access',
      undefined,
    ]);
  });

  it('is the first authorization server named whose metadata the runtime reads, never asking one off https and off the loopback', async () => {
    const issuing = await served({ dynamicRegistration: true });
    const naming = await served({ authorizationServers: [unpinned, issuing.origin] });
    const fetched = recordedFetch();

    expect(await named(askedAt(naming), { fetch: fetched.fetch })).toMatchObject({
      issuer: issuing.origin,
      clients: ['dynamic'],
    });
    expect(offTheLoopbackOf(fetched)).toEqual([]);
  });
});

describe('the protected resource metadata of a server given by hand', () => {
  it('is read where its challenge names it, and at the well-known paths where its challenge names none or an address off https', async () => {
    const issuing = await served({ dynamicRegistration: true });
    const describing = await served({ dynamicRegistration: true, protectedResource: `${issuing.origin}/mcp` });
    const pointed = challengedWith(
      issuing.url,
      `Bearer resource_metadata="${describing.origin}/.well-known/oauth-protected-resource/mcp", scope="files.read"`,
    );
    const offHttps = challengedWith(issuing.url, `Bearer resource_metadata="${unpinned}/prm", scope="files.read"`);
    const bare = challengedWith(issuing.url, 'Bearer realm="files"');

    expect([
      await named(askedAt(issuing), { fetch: pointed.fetch }),
      await named(askedAt(issuing), { fetch: offHttps.fetch }),
      await named(askedAt(issuing), { fetch: bare.fetch }),
    ]).toEqual([
      { issuer: describing.origin, clients: ['dynamic'], scope: 'files.read' },
      { issuer: issuing.origin, clients: ['dynamic'], scope: 'files.read' },
      { issuer: issuing.origin, clients: ['dynamic'], scope: undefined },
    ]);
    expect(offTheLoopbackOf(offHttps)).toEqual([]);
  });

  it('is read at the address its challenge names alone, and at the well-known paths where that address publishes none', async () => {
    const hidden = await served({ dynamicRegistration: true, resourceMetadataPath: '/metadata/files' });
    const issuing = await served({ dynamicRegistration: true });
    const silent = await served({ publishesMetadata: false });
    const pointedAtNothing = challengedWith(
      issuing.url,
      `Bearer resource_metadata="${silent.origin}/.well-known/oauth-protected-resource/mcp"`,
    );

    expect([await named(askedAt(hidden)), await named(askedAt(issuing), { fetch: pointedAtNothing.fetch })]).toEqual([
      { issuer: hidden.origin, clients: ['dynamic'], scope: undefined },
      { issuer: issuing.origin, clients: ['dynamic'], scope: undefined },
    ]);
  });
});

describe('a server given by hand that names no authorization server', () => {
  it('is one that answers without asking for a token, publishes no metadata, or names no authorization server in it', async () => {
    const open = await serveFakeMcp();
    closing.push(open.close);
    const silent = await served({ publishesMetadata: false });
    const nameless = await served({ authorizationServers: [] });

    expect([await refused(askedAt(open)), await refused(askedAt(silent)), await refused(askedAt(nameless))]).toEqual(
      Array.from({ length: 3 }, () => ({ refused: 'no_authorization_server' })),
    );
  });
});

describe('a way of consent refused for what its server says', () => {
  it('is refused where the server names a resource other than its own address', async () => {
    const elsewhere = await served({ protectedResource: 'https://elsewhere.example.com/mcp' });

    expect(await refused(askedAt(elsewhere))).toEqual({
      refused: 'another_resource',
      named: 'https://elsewhere.example.com/mcp',
    });
  });

  it('is refused where its scope is not one, as a challenge or a listing may write it', async () => {
    const listing = await served({ dynamicRegistration: true, protectedScopes: ['files.read', ''] });

    expect(await refused(askedAt(listing))).toEqual({ refused: 'malformed_scope' });
  });
});

describe('a way of consent refused for what its authorization server says', () => {
  it('names the issuer whose metadata cannot be read, names another issuer, lacks S256 or takes no client of the runtime’s own', async () => {
    const offHttps = await served({ authorizationServers: [unpinned] });
    const fetched = recordedFetch();
    const echoing = await served({ issuer: 'https://elsewhere.example.com' });
    const plain = await served({ dynamicRegistration: true, challengeMethods: ['plain'] });
    const closed = await served();

    expect([
      await refused(askedAt(offHttps), { fetch: fetched.fetch }),
      await refused(askedAt(echoing)),
      await refused(askedAt(plain)),
      await refused(askedAt(closed)),
    ]).toEqual([
      { refused: 'at_the_issuer', issuer: unpinned, refusal: { refused: 'no_metadata' } },
      {
        refused: 'at_the_issuer',
        issuer: echoing.origin,
        refusal: { refused: 'another_issuer', named: 'https://elsewhere.example.com', by: 'authorization_server' },
      },
      { refused: 'at_the_issuer', issuer: plain.origin, refusal: { refused: 'no_challenge' } },
      { refused: 'at_the_issuer', issuer: closed.origin, refusal: { refused: 'no_client' } },
    ]);
    expect(offTheLoopbackOf(fetched)).toEqual([]);
  });
});

describe('the hosts the naming of a way reaches', () => {
  it('are refused in the words of the rule, at the server itself and among the endpoints of its authorization server', async () => {
    const elsewhere = await served({ dynamicRegistration: true, endpointHost: 'localhost' });
    const fake = await served({ dynamicRegistration: true });

    expect([
      await refused(askedAt(elsewhere, onLoopbackAlone)),
      await refused(askedAt(fake, refusingEveryHost)),
    ]).toEqual([
      { refused: 'host', rule },
      { refused: 'host', rule },
    ]);
  });
});

describe('the naming of a way that cannot ask the server', () => {
  it('is unanswered where the server does not answer within the bound of a request', async () => {
    const silent = await serveOnLoopback(() => () => Promise.withResolvers<Response>().promise);
    closing.push(silent.close);

    expect(await refused({ url: `${silent.origin}/mcp`, reaches: everyHost }, { requestMs: 50 })).toEqual({
      refused: 'unanswered',
    });
  });

  it('is unanswered at the issuer where its authorization server answers its metadata with an error', async () => {
    const fake = await served({ dynamicRegistration: true });

    expect(await refused(askedAt(fake), { fetch: failingAt('oauth-authorization-server') })).toEqual({
      refused: 'at_the_issuer',
      issuer: fake.origin,
      refusal: { refused: 'unanswered' },
    });
  });
});
