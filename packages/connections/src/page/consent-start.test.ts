import { createHash } from 'node:crypto';

import type { ClientRegistration, FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, crm } from '../testing/additions.ts';
import { consentFake, consentHarnessAt, startedAt, starting, studioReturn } from '../testing/consents.ts';
import { acmeViewer, grace, harness, operationNamed } from '../testing/harness.ts';

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

describe('the start of a consent, as the link shows it', () => {
  it('is shown on the link while it is open', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    const reading = () =>
      h.call(
        operationNamed(h.operations, 'read_link'),
        acmeViewer,
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
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    const secret = await added(h, crm);

    expect([
      await starting(h, { ...link, token: 'unknown' }),
      await starting(h, link, '2026-10-15T14:11:00.000Z'),
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
    const another = await served({ authorizationServer: 'https://elsewhere.example.com' });
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
        detail:
          'The authorization server of the connection files did not answer as an authorization server does; try again in a moment',
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
