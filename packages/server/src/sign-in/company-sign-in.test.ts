import { personIdOf, UnusableIdentityProviderError, type RelyingParty } from '@on.auto/openid-connect';
import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { rowsOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { signInRoutesOf } from './company-sign-in.ts';
import { providerOverHttps } from './issuer-over-https.ts';

const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

interface Asking {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

type FakeProvider = Awaited<ReturnType<typeof providerOverHttps>>;

interface SigningIn {
  readonly provider: FakeProvider;
  readonly server: Awaited<ReturnType<typeof startServer>>;
  readonly address: string;
  readonly at: (path: string, init?: Asking) => Promise<Response>;
  readonly sessionsKept: () => Promise<readonly unknown[]>;
  readonly peopleKept: () => Promise<readonly unknown[]>;
}

function environmentOf(provider: FakeProvider, port: number): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    OIDC_ISSUER: provider.issuer,
    OIDC_CLIENT_ID: provider.clientId,
    OIDC_CLIENT_SECRET: provider.clientSecret,
  };
}

async function signingIn(
  options: Parameters<typeof providerOverHttps>[1] = {},
  settings: Readonly<Record<string, string>> = {},
): Promise<SigningIn> {
  const provider = await providerOverHttps('/tenant/v2.0', options);
  const port = await aPortNothingListensOn();
  const ledger = temporaryLedger();
  const environment = { ...environmentOf(provider, port), ...settings, LEDGER_FILE: ledger.fileName };
  const server = await startServer(environment, compositionRoot);
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  const at = (path: string, init: Asking = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });
  const sessionsKept = () => rowsOfTheLedgerIn(ledger.fileName, 'auth_sessions');
  const peopleKept = () => rowsOfTheLedgerIn(ledger.fileName, 'auth_people');
  return { provider, server, address: `http://localhost:${port}`, at, sessionsKept, peopleKept };
}

function cookiesOf(answer: Readonly<Response>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    answer.headers.getSetCookie().map((cookie) => {
      const [pair = '', ...attributes] = cookie.split('; ');
      const [name = '', value = ''] = pair.split('=');
      const kept = attributes.filter((attribute) => !attribute.startsWith('Expires='));
      return [name, [value === '' ? 'ended' : 'set', ...kept.toSorted()].join('; ')];
    }),
  );
}

function cookieValueOf(answer: Readonly<Response>, name: string): string {
  const named = answer.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return String(named?.split(';')[0]);
}

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names', () => {
  it('sends a person to the provider, keeps their session in the store when they come back, and ends it when they sign out', async () => {
    const { provider, server, address, at, sessionsKept } = await signingIn();

    const started = await at('/auth/oidc');
    const location = String(started.headers.get('location'));
    const callback = await at(`/auth/oidc/callback?${provider.signedIn(location, subject)}`, {
      headers: { cookie: cookieValueOf(started, '__Host-sign-in') },
    });
    const session = cookieValueOf(callback, '__Host-session');
    const keptOnceSignedIn = await sessionsKept();
    const foreign = await at('/auth/sign-out', {
      method: 'POST',
      headers: { cookie: session, origin: 'https://elsewhere.example' },
    });
    const signedOut = await at('/auth/sign-out', { method: 'POST', headers: { cookie: session, origin: address } });

    expect(server.signIn).toEqual({ issuer: provider.issuer, publicUrl: address });
    expect([started.status, location.startsWith(`${provider.issuer}/authorize?`)]).toEqual([302, true]);
    expect(new URL(location).searchParams.get('redirect_uri')).toBe(`${address}/auth/oidc/callback`);
    expect(cookiesOf(started)).toEqual({
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
    const started = await at('/auth/oidc');
    const location = String(started.headers.get('location'));

    const unstarted = await at(`/auth/oidc/callback?${provider.signedIn(location, subject)}`);
    const refused = await at(`/auth/oidc/callback?${provider.refused(location, 'access_denied')}`, {
      headers: { cookie: cookieValueOf(started, '__Host-sign-in') },
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
    const provider = await providerOverHttps('/tenant/v2.0', { metadata: { token_endpoint: undefined } });
    const port = await aPortNothingListensOn();
    const ledger = temporaryLedger();
    onTestFinished(() => {
      ledger.remove();
    });

    await expect(
      startServer({ ...environmentOf(provider, port), LEDGER_FILE: ledger.fileName }, compositionRoot),
    ).rejects.toBeInstanceOf(UnusableIdentityProviderError);
  });
});

async function callbackFor(
  { provider, at }: SigningIn,
  who: string,
  idToken: Readonly<Record<string, unknown>> = {},
  cookie = '',
): Promise<Response> {
  const started = await at('/auth/oidc');
  const pending = cookieValueOf(started, '__Host-sign-in');
  return at(`/auth/oidc/callback?${provider.signedIn(String(started.headers.get('location')), who, idToken)}`, {
    headers: { cookie: [pending, cookie].filter((value) => value !== '').join('; ') },
  });
}

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, as it decides who each is to it', () => {
  it('makes the first person to sign in the admin and the next a viewer before their sessions, keeps each by id, and gives one an admin removed no session', async () => {
    const signingInHere = await signingIn({ idToken: { name: 'A colleague' } });
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
    const signingInHere = await signingIn({}, { OIDC_REQUIRED_CLAIM: 'tenant=acme' });
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

function notAsked(): Promise<never> {
  return Promise.reject(new Error('Not asked'));
}

describe('the sign-in routes of a composition that opens no sign-in store', () => {
  it('are refused as a defect of that composition, since it keeps no session', () => {
    const relyingParty: RelyingParty = {
      issuer: 'https://login.example.com/tenant/v2.0',
      redirectUri: 'https://auto.example.com/auth/oidc/callback',
      signInStarted: notAsked,
      signInFinished: notAsked,
    };
    const routesOf = signInRoutesOf({ relyingParty, publicUrl: 'https://auto.example.com', requiredClaim: undefined });

    expect(() => routesOf(Function.constVoid)).toThrow(Error);
  });
});
