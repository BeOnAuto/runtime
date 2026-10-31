import { providerListOf } from '@on.auto/providers/testing';
import type {
  AuthSettings,
  ConnectionServer,
  ConnectionUnready,
  ConsentCredential,
  SecretReadingFailure,
} from '@on.auto/tool-servers';
import { clockAt, manualTimer, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect, Function, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { added, reconnected } from '../testing/additions.ts';
import {
  orgsClientSecret,
  connectedThrough,
  consentHarnessAt,
  givingTheClient,
  orgsOAuthClientFake,
  underTheOrgsOAuthClient,
} from '../testing/consents.ts';
import { harnessPages, loopbackPolicy, type Harness } from '../testing/harness.ts';
import { makeConnectionSource } from './connection-source.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function connectedUnderTheOrgsOAuthClient() {
  const fake: FakeMcpServer = await orgsOAuthClientFake();
  closing.push(fake.close);
  const h = consentHarnessAt(fake);
  const link = await added(h, underTheOrgsOAuthClient);
  await givingTheClient(h, link);
  await connectedThrough(h, link);
  return { fake, h, id: link.id };
}

function sourceOf(h: Harness, secrets: Pick<SecretKeeping, 'read' | 'replace' | 'claim'> = h.secrets) {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets,
    policy: loopbackPolicy,
    pages: harnessPages,
    variables: new Map(),
    modelProviders: [],
    providers: providerListOf(),
    providerValues: new Map(),
  });
}

async function preparedIn(
  h: Harness,
  secrets?: Pick<SecretKeeping, 'read' | 'replace' | 'claim'>,
): Promise<Effect.Effect<ConnectionServer, ConnectionUnready>> {
  const [listed] = await Effect.runPromise(sourceOf(h, secrets).connectionsOf('acme'));
  return listed?.state.status === 'connected' ? listed.state.server : Effect.die(new Error('Expected it connected'));
}

function isConsent(credential: AuthSettings['credential'] | undefined): credential is ConsentCredential {
  return credential?.kind === 'consent';
}

async function consentOf(h: Harness): Promise<ConsentCredential> {
  const { settings } = await Effect.runPromise(await preparedIn(h));
  return Option.getOrThrow(Option.liftPredicate(settings.auth?.credential, isConsent));
}

const clientSecretUnread: SecretReadingFailure = {
  _tag: 'keeper_unavailable',
  detail: 'The secret manager did not answer',
};

function readingAllBut(h: Harness, unread: string): Pick<SecretKeeping, 'read' | 'replace' | 'claim'> {
  return {
    ...h.secrets,
    read: (secretId) => (secretId === unread ? Effect.fail(clientSecretUnread) : h.secrets.read(secretId)),
  };
}

describe('a connection under the organization’s own OAuth client, as it is served', () => {
  it('is served with the organization’s own OAuth client, through which its tokens are renewed', async () => {
    const { fake, h } = await connectedUnderTheOrgsOAuthClient();
    const consent = await consentOf(h);
    const clock = clockAt(Date.parse('2026-10-15T14:00:00.000Z'));
    const source = h.consent.tokenSource(consent, {
      name: 'files',
      holder: 'connection files',
      now: clock.now,
      timer: manualTimer().timer,
      hold: Function.constVoid,
    });

    clock.setTo(Date.parse('2026-10-15T14:59:00.000Z'));
    const renewed = await source.token();

    expect(consent).toMatchObject({
      client: { client_id: 'org-app', client_source: 'own' },
      way: { oauth_client: 'own' },
      ownClient: { clientId: 'org-app' },
    });
    expect(Redacted.value(Option.getOrThrow(Option.fromNullishOr(consent.ownClient?.clientSecret)))).toBe(
      orgsClientSecret,
    );
    expect(renewed).toEqual(expect.any(String));
    expect(fake.tokenRequests()).toBe(2);
  });

  it('is served with the client it runs under while a next client given on the page waits for a sign-in', async () => {
    const { h, id } = await connectedUnderTheOrgsOAuthClient();
    const next = { client_id: 'another-app', client_secret: 'another-app-client-secret-0c4f' };
    await givingTheClient(h, await reconnected(h, id), next);

    const consent = await consentOf(h);

    expect(consent).toMatchObject({ client: { client_id: 'org-app' }, ownClient: { clientId: 'org-app' } });
    expect(Redacted.value(Option.getOrThrow(Option.fromNullishOr(consent.ownClient?.clientSecret)))).toBe(
      orgsClientSecret,
    );
  });
});

describe('a connection under the organization’s own OAuth client whose client secret is not had, as it is served', () => {
  it('is broken at first use where the client secret of the organization’s own OAuth client is no longer in the secret store', async () => {
    const { h, id } = await connectedUnderTheOrgsOAuthClient();
    await Effect.runPromise(h.secrets.forget('secret-1'));

    const refused = await Effect.runPromise(Effect.flip(await preparedIn(h)));
    const detail =
      "The client secret of the organization's own OAuth client for the connection files is no longer in the secret store, so the person who added it reconnects it and gives its client ID and client secret again";

    expect(refused).toEqual({ because: 'connection_broken', detail });
    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_broken',
      data: { connection: id, kind: 'credential_gone', reason: detail },
    });
  });

  it('is unavailable where the client secret of the organization’s own OAuth client cannot be read now, and is not broken', async () => {
    const { h } = await connectedUnderTheOrgsOAuthClient();

    const refused = await Effect.runPromise(Effect.flip(await preparedIn(h, readingAllBut(h, 'secret-1'))));

    expect(refused).toEqual({
      because: 'connection_unavailable',
      detail: 'The credential of the connection files cannot be read now: The secret manager did not answer',
    });
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_broken');
  });
});
