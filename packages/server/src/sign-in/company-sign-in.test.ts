import type { ApiEnv, Routes } from '@on.auto/api';
import {
  ClientRegistrationError,
  personIdOf,
  UnusableIdentityProviderError,
  type RelyingParty,
} from '@on.auto/openid-connect';
import { sessionRowsInMemory, type FakeProviderOptions } from '@on.auto/openid-connect/testing';
import { Context, Function } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { signInRoutesOf } from './company-sign-in.ts';
import { callbackFor, cookiesOf, cookieValueOf, signingIn, startOf, subject } from './signing-in.ts';

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names', () => {
  it('sends a person to the provider, keeps their session in the store when they come back, and ends it when they sign out', async () => {
    const { provider, server, address, at, sessionsKept } = await signingIn();

    const begun = await at('/auth/oidc');
    const location = String(begun.headers.get('location'));
    const callback = await at(`/auth/oidc/callback?${provider.signedIn(location, subject)}`, {
      headers: { cookie: cookieValueOf(begun, '__Host-sign-in') },
    });
    const session = cookieValueOf(callback, '__Host-session');
    const keptOnceSignedIn = await sessionsKept();
    const foreign = await at('/auth/sign-out', {
      method: 'POST',
      headers: { cookie: session, origin: 'https://elsewhere.example' },
    });
    const signedOut = await at('/auth/sign-out', { method: 'POST', headers: { cookie: session, origin: address } });

    expect(server().signIn).toEqual({ issuer: provider.issuer, publicUrl: address });
    expect([begun.status, location.startsWith(`${provider.issuer}/authorize?`)]).toEqual([302, true]);
    expect(new URL(location).searchParams.get('redirect_uri')).toBe(`${address}/auth/oidc/callback`);
    expect(cookiesOf(begun)).toEqual({
      '__Host-sign-in': 'set; HttpOnly; Max-Age=600; Path=/; SameSite=Lax; Secure',
    });
    expect([callback.status, callback.headers.get('location'), callback.headers.get('cache-control')]).toEqual([
      303,
      '/',
      'no-store',
    ]);
    expect(cookiesOf(callback)).toEqual({
      '__Host-sign-in': 'ended; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure',
      '__Host-session': 'set; HttpOnly; Max-Age=2592000; Path=/; SameSite=Strict; Secure',
    });
    expect([foreign.status, cookiesOf(foreign)]).toEqual([403, {}]);
    expect([signedOut.status, signedOut.headers.get('location')]).toEqual([303, '/']);
    expect(cookiesOf(signedOut)).toEqual({
      '__Host-session': 'ended; HttpOnly; Max-Age=0; Path=/; SameSite=Strict; Secure',
    });
    const hashed: unknown = expect.stringMatching(/^[\da-f]{64}$/u);
    const keptAsGiven: unknown = expect.objectContaining({ sha256: hashed, issuer: provider.issuer, subject });
    expect([keptOnceSignedIn, await sessionsKept()]).toEqual([[keptAsGiven], []]);
    expect(JSON.stringify(keptOnceSignedIn)).not.toContain(session.replace('__Host-session=', ''));
  });
});

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, as it refuses', () => {
  it('refuses a callback that no sign-in started here, or one the provider refused, and takes no token of another issuer', async () => {
    const { provider, at } = await signingIn();
    const begun = await at('/auth/oidc');
    const location = String(begun.headers.get('location'));

    const unstarted = await at(`/auth/oidc/callback?${provider.signedIn(location, subject)}`);
    const refused = await at(`/auth/oidc/callback?${provider.refused(location, 'access_denied')}`, {
      headers: { cookie: cookieValueOf(begun, '__Host-sign-in') },
    });
    const restarted = await at('/auth/oidc');
    const tampered = provider
      .signedIn(String(restarted.headers.get('location')), subject)
      .replace(/state=[\w-]+/u, 'state=another');
    const failed = await at(`/auth/oidc/callback?${tampered}`, {
      headers: { cookie: cookieValueOf(restarted, '__Host-sign-in') },
    });
    const metadata = await at('/.well-known/oauth-protected-resource');
    const playbooks = await at('/v1/orgs/acme/playbooks', { headers: { authorization: 'Bearer a.b.c' } });

    expect([unstarted.status, refused.status, failed.status]).toEqual([400, 400, 400]);
    expect(Object.keys(cookiesOf(refused))).toEqual(['__Host-sign-in']);
    expect([metadata.status, metadata.headers.get('www-authenticate')]).toEqual([401, 'Bearer']);
    expect([playbooks.status, playbooks.headers.get('www-authenticate')]).toEqual([
      401,
      'Bearer error="invalid_token"',
    ]);
  });

  it('refuses to start where the provider cannot be used', async () => {
    expect(await startOf({ metadata: { token_endpoint: undefined } }, false)).toBeInstanceOf(
      UnusableIdentityProviderError,
    );
  });

  it.each<[string, string, FakeProviderOptions]>([
    ['offers no registration', 'OIDC_CLIENT_ID', { metadata: { registration_endpoint: undefined } }],
    ['refuses the registration', 'OIDC_ISSUER', { registrationError: 'invalid_client_metadata' }],
  ])('refuses to start with no client given, where the provider %s, naming %s', async (_case, setting, options) => {
    const refusal = await startOf(options, true);

    expect(/^([A-Z_]+):/u.exec(String(Reflect.get(new Object(refusal), 'message')))?.[1]).toBe(setting);
  });
});

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, as it decides who each is to it', () => {
  it('makes the first person to sign in the admin and the next a viewer before their sessions, keeps each by id, and gives one an admin removed no session', async () => {
    const signingInHere = await signingIn({ provider: { idToken: { name: 'A colleague' } } });
    const { provider, at, peopleKept } = signingInHere;
    const [ada, priya] = ['Ada', 'Priya'].map((who) => personIdOf({ issuer: provider.issuer, subject: who }));

    const first = await callbackFor(signingInHere, 'Ada');
    const asAda = { cookie: cookieValueOf(first, '__Host-session'), 'x-csrf': '1' };
    const next = await callbackFor(signingInHere, 'Priya');
    const again = await callbackFor(signingInHere, 'Ada');
    const listed = await at('/v1/orgs/default/role-assignments', { headers: asAda });
    const removed = await at(`/v1/orgs/default/role-assignments/${String(priya)}/viewer`, {
      method: 'DELETE',
      headers: asAda,
    });
    const refused = await callbackFor(signingInHere, 'Priya');

    expect([first.status, next.status, again.status, removed.status, refused.status]).toEqual([
      303, 303, 303, 200, 403,
    ]);
    const bothRecorded: unknown = expect.arrayContaining([
      expect.objectContaining({
        principal: { type: 'person', id: ada },
        role: { type: 'built_in', id: 'admin' },
        source: 'bootstrap',
        assigned_by: `person:${String(ada)}`,
      }),
      expect.objectContaining({
        principal: { type: 'person', id: priya },
        role: { type: 'built_in', id: 'viewer' },
        source: 'enrolment',
        assigned_by: `person:${String(priya)}`,
      }),
    ]);
    expect(await listed.json()).toMatchObject({ role_assignments: bothRecorded });
    expect(await refused.json()).toMatchObject({ status: 403, reason: 'forbidden' });
    expect(Object.keys(cookiesOf(refused))).toEqual(['__Host-sign-in']);
    const bothKept: unknown = expect.arrayContaining([
      expect.objectContaining({ person: ada, name: 'A colleague', email_address: null }),
      expect.objectContaining({ person: priya, name: 'A colleague' }),
    ]);
    expect(await peopleKept()).toEqual(bothKept);
  });
});

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, as it requires the claim OIDC_REQUIRED_CLAIM names', () => {
  it('refuses a person whose ID Token lacks the claim or carries another value before any role, record or session, and ends the session the browser held', async () => {
    const signingInHere = await signingIn({ settings: { OIDC_REQUIRED_CLAIM: 'tenant=acme' } });
    const { provider, at, sessionsKept, peopleKept } = signingInHere;
    const ada = personIdOf({ issuer: provider.issuer, subject: 'Ada' });

    const lacking = await callbackFor(signingInHere, 'Priya');
    const another = await callbackFor(signingInHere, 'Priya', { tenant: 'Acme' });
    const keptOnceRefused = [await peopleKept(), await sessionsKept()];
    const carrying = await callbackFor(signingInHere, 'Ada', { tenant: 'acme' });
    const asAda = { cookie: cookieValueOf(carrying, '__Host-session'), 'x-csrf': '1' };
    const listed = await at('/v1/orgs/default/role-assignments', { headers: asAda });
    const elsewhere = await callbackFor(signingInHere, 'Ada', { tenant: 'another' }, asAda.cookie);

    expect([lacking.status, another.status, carrying.status, elsewhere.status]).toEqual([403, 403, 303, 403]);
    expect(await another.json()).toMatchObject({ status: 403, reason: 'forbidden' });
    expect(Object.keys(cookiesOf(another))).toEqual(['__Host-sign-in']);
    expect(keptOnceRefused).toEqual([[], []]);
    expect(await listed.json()).toMatchObject({
      role_assignments: [expect.objectContaining({ principal: { type: 'person', id: ada }, source: 'bootstrap' })],
    });
    expect(await sessionsKept()).toEqual([]);
  });
});

function clientIdOf(answer: Readonly<Response>): string | null {
  return new URL(String(answer.headers.get('location'))).searchParams.get('client_id');
}

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, with no client given', () => {
  it('registers itself as it starts, signs people in as that client, and keeps using it after a restart', async () => {
    const signingInHere = await signingIn({ registered: true });
    const { provider, at, restarted } = signingInHere;
    const asked = provider.registrationsAsked().length;

    const first = await callbackFor(signingInHere, 'Ada');
    const before = await at('/auth/oidc');
    await restarted();
    const after = await at('/auth/oidc');
    const unstarted = await at(
      `/auth/oidc/callback?${provider.signedIn(String(after.headers.get('location')), 'Ada')}`,
    );

    expect([asked, provider.registrationsAsked().length]).toEqual([1, 1]);
    expect([first.status, unstarted.status]).toEqual([303, 400]);
    expect(clientIdOf(after)).toBe(clientIdOf(before));
    expect(clientIdOf(after)).not.toBe(provider.clientId);
  });

  it('registers anew once the provider refuses the client it used, so the person signs in at the next try', async () => {
    const signingInHere = await signingIn({ registered: true });
    const { provider, at } = signingInHere;
    const begun = await at('/auth/oidc');
    provider.withdraw(String(clientIdOf(begun)));

    const refused = await callbackFor(signingInHere, 'Ada');
    const again = await callbackFor(signingInHere, 'Ada');

    expect([refused.status, again.status]).toEqual([400, 303]);
    expect(provider.registrationsAsked()).toHaveLength(2);
  });
});

const relyingParty: RelyingParty = {
  issuer: 'https://login.example.com/tenant/v2.0',
  redirectUri: 'https://auto.example.com/auth/oidc/callback',
  signInStarted: () => Promise.reject(new Error('Not asked')),
  signInFinished: () => Promise.reject(new Error('Not asked')),
};

const served = {
  sessionRows: sessionRowsInMemory(),
  peopleRows: { kept: () => Promise.resolve(), listed: () => Promise.resolve([]), deleted: () => Promise.resolve() },
  enrolling: {
    enrolled: () => Promise.reject(new Error('Not asked')),
    firstAdminAwaited: () => Promise.resolve(false),
  },
};

async function startAnsweredWhen(signInStarted: RelyingParty['signInStarted']): Promise<number> {
  const app = new Hono<ApiEnv>();
  const signIn = { relyingParty: { ...relyingParty, signInStarted }, publicUrl: 'https://auto.example.com' };
  const routes: Routes = {
    add: Function.constVoid,
    addPublic: (method, path, handler) => {
      app.on(method, path, handler);
    },
    onClose: Function.constVoid,
    reportThrown: (thrown) => {
      throw thrown;
    },
    resource: undefined,
    callContext: () => Context.empty(),
  };
  for (const register of await signInRoutesOf({ ...signIn, requiredClaim: undefined })(Function.constVoid, served)) {
    register(routes);
  }
  return (await app.request('/auth/oidc')).status;
}

describe('the start of a sign-in that cannot register its client', () => {
  it('answers that the person is not signed in, and leaves any other failure to the incident it is', async () => {
    const refusal = { issuer: relyingParty.issuer, redirectUri: relyingParty.redirectUri, message: 'Refused' };
    const unregistered = new ClientRegistrationError({ ...refusal, refusal: { refused: 'invalid_client_metadata' } });

    expect([
      await startAnsweredWhen(() => Promise.reject(unregistered)),
      await startAnsweredWhen(() => Promise.reject(new Error('A fault of the test'))),
    ]).toEqual([400, 500]);
  });
});

describe('the sign-in routes of a composition that opens no sign-in store', () => {
  it('are refused as a defect of that composition, since it keeps no session', async () => {
    const routesOf = signInRoutesOf({ relyingParty, publicUrl: 'https://auto.example.com', requiredClaim: undefined });

    await expect(routesOf(Function.constVoid)).rejects.toThrow(Error);
  });
});
