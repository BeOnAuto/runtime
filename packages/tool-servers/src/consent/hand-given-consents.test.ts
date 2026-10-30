import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  brokenAtTheChallenge,
  clockAt,
  connectedByConsent,
  consentClientAt,
  consentClientWith,
  memoryRegistrations,
  metadataWithdrawnFrom,
  rowOf,
  servedOf,
  servedTokensOf,
  startAskedAt,
  type ClientRegistration,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import type { ConsentClient, ConsentServed, ConsentWay, StartAsked } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

function byHandAt(fake: FakeMcpServer, way: Partial<ConsentWay>): StartAsked {
  return { ...startAskedAt(fake, way), server: { type: 'mcp', url: fake.url, givenByHand: true } };
}

function startedAt(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(client.start(asked));
}

const RegisteredNameSchema = Schema.fromJsonString(Schema.Struct({ client_name: Schema.String }));

interface Registering {
  readonly fetch: FetchLike;
  readonly names: () => readonly string[];
}

function registeringNamed(): Registering {
  const names: string[] = [];
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const request = new Request(String(address), Object.assign({}, init));
      if (new URL(request.url).pathname === '/register') {
        names.push(Schema.decodeUnknownSync(RegisteredNameSchema)(await request.clone().text()).client_name);
      }
      return globalThis.fetch(request);
    },
    names: () => [...names],
  };
}

const dynamic: Partial<ConsentWay> = { clients: ['dynamic'] };

describe('the start of a consent at a server given by hand', () => {
  it('asks the person to consent every time, as no start of a provider’s way does unless its way says so', async () => {
    const fake = await served({ dynamicRegistration: true });
    const client = consentClientWith();

    const handGiven = new URL((await startedAt(client, byHandAt(fake, dynamic))).url);
    const provided = new URL((await startedAt(client, startAskedAt(fake, dynamic))).url);

    expect([handGiven.searchParams.get('prompt'), provided.searchParams.has('prompt')]).toEqual(['consent', false]);
  });
});

describe('the client registered dynamically for a server given by hand', () => {
  it('is its own, one for each server at an issuer and apart from a provider’s way there, named for the server’s host', async () => {
    const issuing = await served({ dynamicRegistration: true });
    const another = await served({ authorizationServers: [issuing.origin] });
    const registering = registeringNamed();
    const registrations = memoryRegistrations();
    const client = consentClientWith({ fetch: registering.fetch, registrations });
    const atAnother = byHandAt(another, { ...dynamic, issuer: issuing.origin });

    const clients = [
      await startedAt(client, byHandAt(issuing, dynamic)),
      await startedAt(client, atAnother),
      await startedAt(client, startAskedAt(issuing, dynamic)),
      await startedAt(client, byHandAt(issuing, dynamic)),
    ].map((started) => started.client.client_id);

    expect(clients).toEqual(['registered-1', 'registered-2', 'registered-3', 'registered-1']);
    expect(registering.names()).toEqual([
      `Auto Runtime for ${new URL(issuing.origin).host}`,
      `Auto Runtime for ${new URL(another.origin).host}`,
      'Auto Runtime',
    ]);
    expect(registrations.kept().map(([issuer]) => issuer)).toEqual([issuing.origin, issuing.origin, issuing.origin]);
  });
});

describe('a server given by hand that no longer names its protected resource metadata', () => {
  it('refuses a start it took while the server published it, where a provider’s way goes on with the issuer it names', async () => {
    const fake = await served({ dynamicRegistration: true });
    const withdrawn = metadataWithdrawnFrom(fake.url);
    const client = consentClientWith({ fetch: withdrawn.fetch });
    const before = new URL((await startedAt(client, byHandAt(fake, dynamic))).url);
    withdrawn.withdraw();

    const refused = await Effect.runPromise(Effect.flip(client.start(byHandAt(fake, dynamic))));
    const provided = new URL((await startedAt(client, startAskedAt(fake, dynamic))).url);

    expect(before.searchParams.get('resource')).toBe(fake.url);
    expect(refused).toEqual({ refused: 'authorization_server_unnamed', url: fake.url });
    expect(provided.searchParams.has('resource')).toBe(false);
  });

  it('renews none of its tokens, asking the authorization server nothing, in words that say why', async () => {
    const fake = await served();
    const connected = await connectedByConsent(fake);
    const clock = clockAt(0);
    const consent = servedOf(connected, rowOf(connected, clock.now));
    const withdrawn = metadataWithdrawnFrom(fake.url);
    const handGiven: ConsentServed = { ...consent, server: { type: 'mcp', url: fake.url, givenByHand: true } };
    const { source } = servedTokensOf(handGiven, clock.now, consentClientAt(fake, { fetch: withdrawn.fetch }));
    withdrawn.withdraw();

    clock.setTo(3_540_000);
    const renewed = await source.token().catch((error: unknown) => error);

    expect(renewed).toEqual(
      new Error(
        `The server at ${fake.url} no longer names its authorization server, so the tokens of the connection files cannot be renewed; remove the connection and add it again`,
      ),
    );
    expect(fake.tokenRequests()).toBe(1);
  });
});

describe('a challenge whose address answers with an error', () => {
  it('leads to the well-known paths, at the start of a provider’s way and of a server given by hand alike', async () => {
    const fake = await served({ dynamicRegistration: true });
    const client = consentClientWith({ fetch: brokenAtTheChallenge(fake).fetch });

    const provided = new URL((await startedAt(client, startAskedAt(fake, dynamic))).url);
    const handGiven = new URL((await startedAt(client, byHandAt(fake, dynamic))).url);

    expect([provided.searchParams.get('resource'), handGiven.searchParams.get('resource')]).toEqual([
      fake.url,
      fake.url,
    ]);
  });
});
