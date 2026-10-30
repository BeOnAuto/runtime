import { createHash } from 'node:crypto';

import { servedStudio } from '@on.auto/identity/testing';
import type { ReturnKind } from '@on.auto/tool-servers';
import { servedThroughAuto, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { autoClientsOf, consentedAt, hostOf, type ClientRegistration } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, crm } from '../testing/additions.ts';
import { consentFake, consentHarnessAt, finishing, startedAt, starting, studioReturn } from '../testing/consents.ts';
import { acmeWriter, grace, harness, operationNamed, loopbackAndCrmPolicy } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

async function startedThrough(fake: FakeMcpServer, way: Readonly<Record<string, unknown>> = {}) {
  const h = consentHarnessAt(fake, { way });
  return starting(h, await added(h, { provider: 'files' }));
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('the start of a consent', () => {
  it('answers the page the person signs in at, records the start with the digest of its state, and keeps its verifier sealed', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });

    const { url, expiresAt } = await startedAt(h, link, '2026-10-15T14:02:00.000Z');
    const asked = new URL(url).searchParams;
    const started = (await h.facts()).at(-1);

    expect(`${new URL(url).origin}${new URL(url).pathname}`).toBe(`${fake.origin}/authorize`);
    expect(Object.fromEntries(asked)).toMatchObject({
      client_id: 'auto-runtime',
      redirect_uri: studioReturn,
      scope: 'files.read',
      access_type: 'offline',
      code_challenge_method: 'S256',
    });
    expect(expiresAt).toBe('2026-10-15T14:12:00.000Z');
    expect(started).toMatchObject({
      type: 'connection_consent_started',
      data: {
        connection: link.id,
        state_sha256: digestOf(String(asked.get('state'))),
        client_id: 'auto-runtime',
        client_source: 'registered',
        expires_at: expiresAt,
      },
    });
    expect(JSON.stringify(await h.facts())).not.toContain(String(asked.get('state')));
    expect([...h.secrets.values().values()]).toHaveLength(1);
  });
});

describe('the return address a consent is started and finished with', () => {
  it('is connect-return at the root of the Studio host, where the runtime serves no Studio', async () => {
    const studioHost = { origin: 'https://studio.example.com', served: false };
    const fake = await served();
    const h = consentHarnessAt(fake, { pages: { studio: studioHost, runtime: () => 'https://runtime.example.com' } });

    const { url } = await startedAt(h, await added(h, { provider: 'files' }));

    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://studio.example.com/connect-return');
  });

  it("is connect-return under the runtime's own /studio/ where it serves Studio, and the finish redeems with it", async () => {
    const runtime = 'http://127.0.0.1:5555';
    const servedReturn = `${runtime}/studio/connect-return`;
    const fake = await served({ redirectUris: [servedReturn] });
    const h = consentHarnessAt(fake, { pages: { studio: servedStudio, runtime: () => runtime } });
    const link = await added(h, { provider: 'files' });

    const { url } = await startedAt(h, link);
    const finished = await finishing(h, link, await consentedAt(url));

    expect(new URL(url).searchParams.get('redirect_uri')).toBe(servedReturn);
    expect(finished).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
  });
});

describe('the start of a consent, as the link shows it', () => {
  it('is shown on the link while it is open', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    const reading = () =>
      h.call(
        operationNamed(h.operations, 'read_link'),
        acmeWriter,
        { id: link.id, token: link.token },
        '2026-10-15T14:05:00.000Z',
      );
    const before = await reading();
    await startedAt(h, link, '2026-10-15T14:02:00.000Z');

    expect(before).not.toHaveProperty('output.consent');
    expect(await reading()).toMatchObject({
      output: { consent: { started_at: '2026-10-15T14:02:00.000Z', expires_at: '2026-10-15T14:12:00.000Z' } },
    });
  });

  it('replaces a start that is open and forgets its verifier', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    await startedAt(h, link);
    const [first] = [...h.secrets.values().keys()];

    await startedAt(h, link);

    expect(h.secrets.values().has(String(first))).toBe(false);
    expect(h.secrets.values().size).toBe(1);
  });
});

describe('a start refused by its link', () => {
  it('is refused for a token unknown or expired, to another person, and for a connection that takes no consent', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake, { policy: loopbackAndCrmPolicy });
    const link = await added(h, { provider: 'files' });
    const secret = await added(h, crm);

    expect([
      await starting(h, { ...link, token: 'unknown' }),
      await starting(h, link, '2026-10-16T14:01:00.000Z'),
      await h.call(operationNamed(h.operations, 'start'), grace, { id: link.id, token: link.token }),
      await starting(h, secret),
    ]).toMatchObject([
      { reason: 'not_found' },
      { reason: 'not_found' },
      { reason: 'forbidden' },
      {
        reason: 'conflict',
        detail:
          'The connection crm is not connected by signing in to its provider, so it has no consent to start or finish',
      },
    ]);
  });

  it('forgets the verifier it kept where the start cannot be recorded, as when the connection was removed meanwhile', async () => {
    const fake = await served();
    const removal: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const h = consentHarnessAt(fake, { beforeKeeping: () => removal.run() });
    const link = await added(h, { provider: 'files' });
    removal.run = () => h.call(operationNamed(h.operations, 'remove_connection'), grace, { id: link.id });

    expect(await starting(h, link)).toMatchObject({ reason: 'not_found' });
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('a start refused for its authorization server', () => {
  it('is refused where the server names another authorization server, or where the metadata of its authorization server names another issuer', async () => {
    const another = await served({ authorizationServers: ['https://elsewhere.example.com'] });
    const echoing = await served({ issuer: 'https://elsewhere.example.com' });

    expect([await startedThrough(another), await startedThrough(echoing)]).toMatchObject([
      {
        reason: 'conflict',
        detail: `The server of the connection files names https://elsewhere.example.com as its authorization server, where its provider names ${another.origin}, so it cannot be connected as it was added`,
      },
      {
        reason: 'conflict',
        detail: `The authorization server of the connection files names https://elsewhere.example.com as its issuer in its own metadata, where its provider names ${echoing.origin}, so it cannot be connected as it was added`,
      },
    ]);
  });

  it('is refused where the server names another resource, takes no S256 challenge, publishes no metadata or takes no client the runtime has', async () => {
    const elsewhere = await served({ protectedResource: 'https://elsewhere.example.com/mcp' });
    const plain = await served({ challengeMethods: ['plain'] });
    const silent = await served({ publishesMetadata: false });
    const dynamicLess = await served();

    expect([
      await startedThrough(elsewhere),
      await startedThrough(plain),
      await startedThrough(silent),
      await startedThrough(dynamicLess, { clients: ['registered', 'dynamic'] }),
    ]).toMatchObject([
      {
        reason: 'conflict',
        detail:
          'The server of the connection files names https://elsewhere.example.com/mcp as the resource it protects, which is not its own address, so it cannot be connected as it was added',
      },
      {
        reason: 'conflict',
        detail:
          'The authorization server of the connection files does not take the authorization code with an S256 challenge, which Auto asks for',
      },
      {
        reason: 'conflict',
        detail: `The authorization server of the connection files, ${silent.origin}, publishes no metadata, so it cannot be connected as it was added`,
      },
      { status: 'succeeded' },
    ]);
  });
});

describe('a start refused where the server cannot proceed', () => {
  it('is refused where the server takes none of the clients of the way, or where it does not answer', async () => {
    const fake = await served();
    const gone = await consentFake();
    await gone.close();
    const h = consentHarnessAt(fake, { way: { clients: ['dynamic'] } });
    const unanswering = consentHarnessAt(gone);

    expect([
      await starting(h, await added(h, { provider: 'files' })),
      await starting(unanswering, await added(unanswering, { provider: 'files' })),
    ]).toMatchObject([
      {
        reason: 'conflict',
        detail:
          'The authorization server of the connection files takes none of the clients this runtime has for it, so it cannot be connected as it was added',
      },
      {
        reason: 'unavailable',
        detail: `The consent of the connection files cannot go on: ${hostOf(gone)} could not be reached for the request sent without a token; try again in a moment`,
      },
    ]);
  });

  it('is refused for a host the rules do not allow among the endpoints of the metadata, before the person is sent anywhere', async () => {
    const fake = await served({ endpointHost: 'localhost' });
    const h = consentHarnessAt(fake, { policy: connectionPolicyOf({ allowed_hosts: ['127.0.0.1'] }) });

    expect(await starting(h, await added(h, { provider: 'files' }))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'A connection may not reach the host localhost on this runtime, which allows 127.0.0.1',
    });
    expect(harness().operations.map(({ registration }) => registration.name)).toContain('start');
  });
});

describe('a start through Auto’s consent service for a Studio neither hosted nor on this computer', () => {
  it('is refused before the person is sent anywhere where no other source remains, saying whoever runs the runtime registers a client', async () => {
    const serving = await servedThroughAuto();
    closing.push(serving.close);
    const kinds: { now: ReturnKind } = { now: 'hosted' };
    const autoClients = { ...autoClientsOf(serving.service), returnKindOf: () => kinds.now };
    const h = consentHarnessAt(serving.fake, { consenting: { autoClients } });
    const link = await added(h, { provider: 'files' });
    kinds.now = 'elsewhere';

    expect(await starting(h, link)).toMatchObject({
      reason: 'conflict',
      detail:
        "The connection files takes consent through Auto's client only where Studio is Auto's or on this computer, so whoever runs this runtime registers a client",
    });
    expect([serving.service.calls().map(({ path }) => path), serving.fake.heard()]).toEqual([['/clients'], []]);
  });
});

describe('a start through Auto’s consent service from a Studio host the service does not send people back to', () => {
  it('is refused by the service before the person is sent anywhere, saying whoever runs the runtime registers a client', async () => {
    const serving = await servedThroughAuto();
    closing.push(serving.close);
    const h = consentHarnessAt(serving.fake, { consenting: { autoClients: autoClientsOf(serving.service) } });

    expect(await starting(h, await added(h, { provider: 'files' }))).toMatchObject({
      reason: 'conflict',
      detail:
        "Auto's consent service did not start the consent of the connection files: Auto has no client at its authorization server, or the service does not send people back to the Studio its link opens, so whoever runs this runtime registers a client",
    });
    expect(serving.service.calls().at(-1)?.body).toMatchObject({
      return: { kind: 'hosted', base: 'https://studio.on.auto/' },
    });
    expect(serving.fake.heard().map(({ path }) => path)).not.toContain('/authorize');
  });
});
