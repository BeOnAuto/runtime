import { servedThroughAuto, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import {
  admitted,
  autoClientsOf,
  consentedAt,
  metadataWithdrawnFrom,
  registeredAt,
  type ClientRegistration,
} from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, adding } from '../testing/additions.ts';
import {
  accessTokenKeptIn,
  askedOf,
  byHandAt,
  harnessByHand,
  readingTheLink,
  rewrittenAnswers,
  searchedThrough,
  tokenRequestsSeen,
} from '../testing/by-hand.ts';
import { consentedOf, consentFake, finishing, startedAt, starting } from '../testing/consents.ts';
import { ada, operationNamed } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

const signingIn: Partial<ClientRegistration> = { dynamicRegistration: true, requiredScopes: ['files.read'] };

describe('an MCP server given by hand that signs people in itself', () => {
  it('is added pending with its link, its credential the issuer the server names, the client the runtime registers there and the scope the server asks, registering nothing yet', async () => {
    const fake = await served(signingIn);
    const h = harnessByHand();
    const credential = { kind: 'authorization', issuer: fake.origin, clients: ['dynamic'], scope: 'files.read' };

    const outcome = await adding(h, byHandAt(fake));
    const [fact] = await h.facts();

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { provider: null, status: 'pending', credential, connect: { expires_at: '2026-10-16T14:00:00.000Z' } },
    });
    expect(fact).toMatchObject({ type: 'connection_added', data: { credential } });
    expect(fake.heard().map(({ path }) => path)).not.toContain('/register');
  });
});

describe('the consent of an MCP server given by hand', () => {
  it('is read on its link with the client a start takes, started with a client registered there dynamically for the resource, finished, and served with its token', async () => {
    const fake = await served(signingIn);
    const h = harnessByHand();
    const link = await added(h, byHandAt(fake));

    const read = await readingTheLink(h, link);
    const { url } = await startedAt(h, link);
    const finished = await finishing(h, link, await consentedOf(h, link));
    const { called, close } = await searchedThrough(h);
    closing.push(close);

    expect(read).toMatchObject({ output: { client_source: 'dynamic' } });
    expect(askedOf(url)).toMatchObject({
      client_id: 'registered-1',
      scope: 'files.read',
      resource: fake.url,
      prompt: 'consent',
    });
    expect(finished).toMatchObject({
      output: {
        status: 'connected',
        credential: { issuer: fake.origin, client_id: 'registered-1', client_source: 'dynamic' },
        granted_scope: 'files.read',
      },
    });
    expect(called).toMatchObject({ status: 'succeeded' });
    expect(fake.seen().filter(({ rpc }) => rpc === 'tools/call')).toMatchObject([
      { authorization: `Bearer ${accessTokenKeptIn(h)}` },
    ]);
  });
});

describe('an MCP server given by hand whose issuer takes a client named by a metadata document', () => {
  it('takes a client registered there dynamically where the issuer offers it, and the document only where it registers none', async () => {
    const both = await served({ clientMetadataDocuments: true, dynamicRegistration: true });
    const documenting = await served({ clientMetadataDocuments: true });
    const h = harnessByHand({ consenting: { publicUrl: 'https://runtime.example.com' } });

    const outcome = await adding(h, byHandAt(both));
    const link = await added(h, { ...byHandAt(documenting), name: 'files-documented' });

    expect(outcome).toMatchObject({ output: { credential: { clients: ['dynamic'] } } });
    expect(await readingTheLink(h, link)).toMatchObject({
      output: { credential: { clients: ['metadata_document'] }, client_source: 'metadata_document' },
    });
    expect(await starting(h, link)).toMatchObject({ output: { client_source: 'metadata_document' } });
  });
});

describe('an MCP server given by hand at an issuer where the runtime has clients of its way', () => {
  it('never takes the client registered there, nor Auto’s client, which a way that takes registered clients would', async () => {
    const serving = await servedThroughAuto({ dynamicRegistration: true });
    closing.push(serving.close);
    const { fake } = serving;
    const h = harnessByHand({
      consenting: { autoClients: autoClientsOf(serving.service), registeredClients: [registeredAt(fake.origin)] },
      pages: {
        studio: { origin: 'https://studio.example.com', served: false },
        runtime: () => 'http://localhost:5555',
      },
    });
    const link = await added(h, byHandAt(fake));
    const { sourcesOf } = await Effect.runPromise(h.consent.hadSources('https://studio.example.com/'));

    const read = await readingTheLink(h, link);
    const { url } = await startedAt(h, link);

    expect([sourcesOf({ issuer: fake.origin }), sourcesOf({ issuer: fake.origin, clients: ['dynamic'] })]).toEqual([
      ['registered', 'auto'],
      ['dynamic'],
    ]);
    expect(read).toMatchObject({ output: { credential: { clients: ['dynamic'] }, client_source: 'dynamic' } });
    expect(askedOf(url)).toMatchObject({ client_id: 'registered-1' });
  });
});

describe('an MCP server given by hand that publishes its metadata only at the address its challenge names', () => {
  it('is added, started and finished with its resource on the authorization request and the token request', async () => {
    const fake = await served({ ...signingIn, resourceMetadataPath: '/metadata/files' });
    const seen = tokenRequestsSeen();
    const h = harnessByHand({ consenting: { fetch: seen.fetch } });
    const link = await added(h, byHandAt(fake));

    const { url } = await startedAt(h, link);
    const finished = await finishing(h, link, await consentedAt(url));

    expect(askedOf(url)).toMatchObject({ resource: fake.url });
    expect(finished).toMatchObject({ output: { status: 'connected', credential: { issuer: fake.origin } } });
    expect(seen.resources()).toEqual([fake.url]);
    expect(fake.heard().map(({ path }) => path)).not.toContain('/.well-known/oauth-protected-resource/mcp');
  });
});

const elsewhere = 'https://elsewhere.example.com';

async function movedLater() {
  const fake = await served(signingIn);
  const answers = rewrittenAnswers();
  const h = harnessByHand({ consenting: { fetch: answers.fetch } });
  return { fake, answers, h, link: await added(h, byHandAt(fake)) };
}

describe('the start and the finish of a server given by hand that no longer names the way it was added with', () => {
  it('say at the start that the server names another authorization server, where the server named the issuer', async () => {
    const { fake, answers, h, link } = await movedLater();

    answers.rewrite(`"authorization_servers":["${fake.origin}"]`, `"authorization_servers":["${elsewhere}"]`);

    expect(await starting(h, link)).toMatchObject({
      reason: 'conflict',
      detail: `The server of the connection files names ${elsewhere} as its authorization server, where it named ${fake.origin} when the connection was added, so it cannot be connected as it was added`,
    });
  });

  it('say at the start that the authorization server names an endpoint neither https nor on the loopback', async () => {
    const { fake, answers, h, link } = await movedLater();

    answers.rewrite(
      `"authorization_endpoint":"${fake.origin}/authorize"`,
      '"authorization_endpoint":"http://login.example.com/authorize"',
    );

    expect(await starting(h, link)).toMatchObject({
      reason: 'conflict',
      detail:
        'The authorization server of the connection files names http://login.example.com/authorize as an endpoint, which is neither https nor on a loopback address, so it cannot be connected as it was added',
    });
  });

  it('say at the finish that the authorization server names another issuer, where the server named the issuer', async () => {
    const { fake, answers, h, link } = await movedLater();
    const consented = await consentedAt((await startedAt(h, link)).url);

    answers.rewrite(`"issuer":"${fake.origin}"`, `"issuer":"${elsewhere}"`);

    expect(await finishing(h, link, consented)).toMatchObject({
      reason: 'conflict',
      detail: `The authorization server of the connection files names ${elsewhere} as its issuer in its own metadata, where it named ${fake.origin} when the connection was added, so it cannot be connected as it was added`,
    });
  });
});

async function withdrawnLater() {
  const fake = await served(signingIn);
  const withdrawn = metadataWithdrawnFrom(fake.url);
  const h = harnessByHand({ consenting: { fetch: withdrawn.fetch } });
  return { fake, withdrawn, h, link: await added(h, byHandAt(fake)) };
}

function noLongerNamedAt({ url }: FakeMcpServer): string {
  return `The server at ${url} no longer names its authorization server, so the consent cannot go on; remove the connection and add it again`;
}

describe('a connection given by hand whose server no longer publishes its metadata', () => {
  it('is refused at its start, where the server answers its ping with a 2xx and its well-known paths with 404s, sending the person nowhere', async () => {
    const { fake, withdrawn, h, link } = await withdrawnLater();

    withdrawn.withdraw();

    expect(await starting(h, link)).toMatchObject({ reason: 'conflict', detail: noLongerNamedAt(fake) });
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_consent_started');
  });

  it('is refused at its finish, redeeming no code, so no token is asked without the resource', async () => {
    const { fake, withdrawn, h, link } = await withdrawnLater();
    const consented = await consentedAt((await startedAt(h, link)).url);

    withdrawn.withdraw();

    expect(await finishing(h, link, consented)).toMatchObject({ reason: 'conflict', detail: noLongerNamedAt(fake) });
    expect(fake.tokenRequests()).toBe(0);
  });

  it('is removed with its tokens revoked at the issuer it recorded, so none stays alive', async () => {
    const { fake, withdrawn, h, link } = await withdrawnLater();
    await finishing(h, link, await consentedOf(h, link));
    const accessToken = accessTokenKeptIn(h);

    withdrawn.withdraw();
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(fake.heard().map(({ path }) => path)).toContain('/revoke');
    expect(await admitted(fake, accessToken)).toBe(false);
  });
});
