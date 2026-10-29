import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { consentClientWith, everyHost, failingAt, hostOf } from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import { serveFakeMcp, servedForConsent } from '../testing/served-fakes.ts';
import type { ConsentClientOptions } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function kept<Served extends { readonly close: () => Promise<void> }>(served: Promise<Served>): Promise<Served> {
  const fake = await served;
  closing.push(fake.close);
  return fake;
}

function refused(url: string, options: Partial<ConsentClientOptions> = {}) {
  return Effect.runPromise(Effect.flip(consentClientWith(options).namedWay({ url, reaches: everyHost })));
}

const wellKnownPath = '/.well-known/oauth-protected-resource/mcp';

function unreadAt(host: string, answer: unknown) {
  return { refused: 'unanswered', call: { step: 'resource_metadata', host, answer } };
}

const unreachableAtTheWellKnownPaths: FetchLike = (...[address, init]: readonly [unknown, unknown?]) =>
  new URL(String(address)).pathname.startsWith('/.well-known/')
    ? Promise.reject(new TypeError('fetch failed'))
    : globalThis.fetch(String(address), Object.assign({}, init));

const challengeNamingNoMetadata = { 'www-authenticate': 'Bearer realm="files"' };

function silentAtTheWellKnownPaths(): (request: Readonly<Request>) => Promise<Response> {
  return (request) =>
    new URL(request.url).pathname === '/mcp'
      ? Promise.resolve(new Response(null, { status: 401, headers: challengeNamingNoMetadata }))
      : Promise.withResolvers<Response>().promise;
}

describe('a server given by hand whose answer names no protected resource metadata', () => {
  it('names no authorization server where its well-known paths answer a client error, a refusal or a 406 among them', async () => {
    const open = await kept(serveFakeMcp());
    const bearing = await kept(serveFakeMcp({ bearer: 'files-token' }));

    expect([await refused(open.url), await refused(bearing.url)]).toEqual(
      Array.from({ length: 2 }, () => ({ refused: 'no_authorization_server' })),
    );
    expect(bearing.heard().map(({ path }) => path)).toEqual([
      '/mcp',
      wellKnownPath,
      '/.well-known/oauth-protected-resource',
    ]);
  });

  it('is unanswered where its well-known paths answer a server error, fail on the network or do not answer in time', async () => {
    const bearing = await kept(serveFakeMcp({ bearer: 'files-token' }));
    const silent = await kept(serveOnLoopback(silentAtTheWellKnownPaths));
    expect([
      await refused(bearing.url, { fetch: failingAt(wellKnownPath) }),
      await refused(bearing.url, { fetch: unreachableAtTheWellKnownPaths }),
      await refused(`${silent.origin}/mcp`, { requestMs: 50 }),
    ]).toMatchObject([
      unreadAt(hostOf(bearing), { status: 500, retryAfterMs: null }),
      unreadAt(hostOf(bearing), { failed: 'failing' }),
      { refused: 'unanswered', call: { host: hostOf(silent), answer: { failed: 'timed_out' } } },
    ]);
    expect(silent.heard().map(({ path }) => path)).toEqual(['/mcp', wellKnownPath]);
  });
});

describe('a server given by hand whose challenge names protected resource metadata', () => {
  it('is unanswered where that metadata cannot be read there nor at its well-known paths', async () => {
    const fake = await kept(servedForConsent({ dynamicRegistration: true }));

    expect(await refused(fake.url, { fetch: failingAt(wellKnownPath) })).toEqual(
      unreadAt(hostOf(fake), { status: 500, retryAfterMs: null }),
    );
  });
});
