import { providerListOf } from '@on.auto/providers/testing';
import type {
  AuthSettings,
  ConnectionServer,
  ConnectionUnready,
  ConsentCredential,
  OrgConnection,
} from '@on.auto/tool-servers';
import { clockAt, manualTimer, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect, Function, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, finishing, studioReturn } from '../testing/consents.ts';
import { harnessPages, type Harness } from '../testing/harness.ts';
import { makeConnectionSource } from './connection-source.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const consentEnded =
  'The consent of the connection files was revoked or has ended, so the person who added it removes it and adds it again';

const clientGone =
  'The client the connection files was made with is no longer registered, so the person who added it removes it and adds it again';

const notTokens =
  'The credential of the connection files cannot be read, so the person who added it removes it and adds it again: its value is not the tokens of a consent the runtime keeps';

const gone =
  'The credential of the connection files is no longer in the secret store, so the person who added it removes it and adds it again';

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake();
  closing.push(fake.close);
  return fake;
}

async function connectedByConsent(way?: Readonly<Record<string, unknown>>) {
  const fake = await served();
  const h = consentHarnessAt(fake, way === undefined ? {} : { way });
  const link = await added(h, { provider: 'files' });
  await finishing(h, link, await consentedOf(h, link));
  return { fake, h, id: link.id };
}

function sourceOf(h: Harness) {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    pages: harnessPages,
    variables: new Map(),
    modelProviders: [],
    providers: providerListOf(),
    providerValues: new Map(),
  });
}

function preparedOf(connection: OrgConnection | undefined): Effect.Effect<ConnectionServer, ConnectionUnready> {
  return connection?.state.status === 'connected'
    ? connection.state.server
    : Effect.die(new Error('Expected a connected connection'));
}

async function preparedIn(h: Harness): Promise<Effect.Effect<ConnectionServer, ConnectionUnready>> {
  const [listed] = await Effect.runPromise(sourceOf(h).connectionsOf('acme'));
  return preparedOf(listed);
}

async function consentOf(h: Harness): Promise<ConsentCredential> {
  const { settings } = await Effect.runPromise(await preparedIn(h));
  const credential = settings.auth?.credential;
  return Option.getOrThrow(Option.liftPredicate(credential, isConsent));
}

function isConsent(credential: AuthSettings['credential'] | undefined): credential is ConsentCredential {
  return credential?.kind === 'consent';
}

function onlyRowOf(h: Harness): readonly [string, string] {
  return Option.getOrThrow(Option.fromNullishOr([...h.secrets.values()].at(0)));
}

describe('a connection connected by consent', () => {
  it('is served with the tokens its row holds, its way, its server and the client it recorded', async () => {
    const { fake, h } = await connectedByConsent();
    const [, value] = onlyRowOf(h);

    const { settings } = await Effect.runPromise(await preparedIn(h));
    const consent = await consentOf(h);

    expect(settings).toMatchObject({
      name: 'files',
      type: 'mcp',
      url: fake.url,
      secrets: [],
      auth: { issuer: fake.origin, client_id: 'auto-runtime', scope: 'files.read' },
    });
    expect(consent).toMatchObject({
      kind: 'consent',
      server: { type: 'mcp', url: fake.url },
      way: { issuer: fake.origin, scope: 'files.read', parameters: { access_type: 'offline' } },
      returnAddress: studioReturn,
      client: { client_id: 'auto-runtime', client_source: 'registered' },
      held: { version: 1, claimedUntil: undefined },
    });
    expect(JSON.stringify(consent.held.tokens)).toBe(value);
  });

  it('is served with no scope where its consent was given none', async () => {
    const { h } = await connectedByConsent({});

    const { settings } = await Effect.runPromise(await preparedIn(h));

    expect(settings.auth?.scope).toBeNull();
  });
});

describe('a connection connected by consent whose row cannot be served', () => {
  it('is broken at first use in the words of a credential unreadable where its row holds no tokens', async () => {
    const { h } = await connectedByConsent();
    const [secretId] = onlyRowOf(h);
    await Effect.runPromise(h.secrets.replace(secretId, 1, Redacted.make('not the tokens of a consent')));

    const refused = await Effect.runPromise(Effect.flip(await preparedIn(h)));
    const breaks = (await h.facts()).filter(({ type }) => type === 'connection_broken');

    expect(refused).toEqual({ because: 'connection_broken', detail: notTokens });
    expect(breaks).toMatchObject([{ data: { reason: notTokens } }]);
  });

  it('is broken at first use in the words of a credential gone where its row is gone', async () => {
    const { h } = await connectedByConsent();
    const [secretId] = onlyRowOf(h);
    await Effect.runPromise(h.secrets.forget(secretId));

    const refused = await Effect.runPromise(Effect.flip(await preparedIn(h)));

    expect(refused).toEqual({ because: 'connection_broken', detail: gone });
  });
});

describe('the store of the tokens of a connection connected by consent', () => {
  it('claims its row once until the claim ends, and replaces its value under the version read', async () => {
    const { h } = await connectedByConsent();
    const { tokens } = await consentOf(h);
    const renewed = { access_token: 'renewed', token_type: 'Bearer' };

    const claims = [await Effect.runPromise(tokens.claim(1, 30_000)), await Effect.runPromise(tokens.claim(1, 30_000))];
    const whileClaimed = await Effect.runPromise(tokens.read);
    const replaced = await Effect.runPromise(tokens.replace(1, Redacted.make(JSON.stringify(renewed))));
    const moved = await Effect.runPromise(tokens.replace(1, Redacted.make(JSON.stringify(renewed))));
    const read = await Effect.runPromise(tokens.read);

    const refused = await Effect.runPromise(Effect.flip(tokens.replace(2, Redacted.make('x'.repeat(4097)))));

    expect(claims).toEqual([{ claimed: true, until: whileClaimed.claimedUntil }, { claimed: false }]);
    expect(refused).toEqual({ detail: 'A secret to keep holds more than 4096 characters' });
    expect([replaced, moved]).toEqual([{ replaced: true, version: 2 }, { replaced: false }]);
    expect(read).toEqual({ tokens: renewed, version: 2, claimedUntil: undefined });
  });

  it('breaks the connection in the words of an ended consent or of a client gone, recording the break once', async () => {
    const { h, id } = await connectedByConsent();
    const { tokens } = await consentOf(h);

    const ended = await Effect.runPromise(Effect.flip(tokens.broken('consent_ended')));
    const withoutItsClient = await Effect.runPromise(Effect.flip(tokens.broken('client_gone')));
    const [listed] = await Effect.runPromise(sourceOf(h).connectionsOf('acme'));
    const breaks = (await h.facts()).filter(({ type }) => type === 'connection_broken');

    expect([ended, withoutItsClient]).toEqual([
      { because: 'connection_broken', detail: consentEnded },
      { because: 'connection_broken', detail: clientGone },
    ]);
    expect(listed?.state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: consentEnded },
    });
    expect(breaks).toMatchObject([{ data: { connection: id, reason: consentEnded } }]);
  });
});

describe('the tokens of a connection connected by consent, served by the consent client', () => {
  it('are renewed through the row, whose value and version move', async () => {
    const { h, fake } = await connectedByConsent();
    const consent = await consentOf(h);
    const [secretId, first] = onlyRowOf(h);
    const clock = clockAt(Date.parse('2026-10-15T14:00:00.000Z'));
    const source = h.consent.tokenSource(consent, {
      name: 'files',
      holder: `connection ${secretId}`,
      now: clock.now,
      timer: manualTimer().timer,
      hold: Function.constVoid,
    });

    clock.setTo(Date.parse('2026-10-15T14:59:00.000Z'));
    const renewed = await source.token();
    const read = await Effect.runPromise(consent.tokens.read);

    expect(first).not.toContain(renewed);
    expect(read.tokens.access_token).toBe(renewed);
    expect(read.version).toBe(2);
    expect(fake.tokenRequests()).toBe(2);
  });
});
