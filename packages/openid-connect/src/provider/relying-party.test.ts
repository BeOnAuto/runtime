import { createHash } from 'node:crypto';

import { Redacted } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeProvider, type Claims, type FakeProvider, type FakeProviderOptions } from '../testing/fake-provider.ts';
import type { ProviderRequests } from './provider-requests.ts';
import { relyingPartyOf, type FinishedSignIn, type RelyingParty, type RelyingPartySettings } from './relying-party.ts';

const issuer = 'https://login.example.com/tenant/v2.0';

const redirectUri = 'https://auto.example.com/auth/oidc/callback';

const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

const signedIn: FinishedSignIn = { signedIn: { issuer, subject }, claims: {} };

function settingsOf(provider: FakeProvider, changes: Partial<RelyingPartySettings> = {}): RelyingPartySettings {
  return {
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: Redacted.make(provider.clientSecret),
    scopes: ['openid', 'profile', 'email'],
    tokenEndpointAuthMethod: undefined,
    redirectUri,
    ...changes,
  };
}

function providerWith(options: FakeProviderOptions = {}): FakeProvider {
  return fakeProvider(issuer, options);
}

function partyOf(provider: FakeProvider, changes: Partial<RelyingPartySettings> = {}): Promise<RelyingParty> {
  return relyingPartyOf(settingsOf(provider, changes), provider.requests);
}

async function signedInBy(
  party: RelyingParty,
  provider: FakeProvider,
  answered: (query: string) => string = (query) => query,
): Promise<FinishedSignIn> {
  const { authorizationUrl, pending } = await party.signInStarted();
  return party.signInFinished(answered(provider.signedIn(authorizationUrl, subject)), pending);
}

async function signedInThrough(
  provider: FakeProvider,
  changes: Partial<RelyingPartySettings> = {},
  answered?: (query: string) => string,
): Promise<FinishedSignIn> {
  return signedInBy(await partyOf(provider, changes), provider, answered);
}

function withoutIss(query: string): string {
  return query.replace(/&?iss=[^&]*/u, '');
}

function withAnotherIss(query: string): string {
  return query.replace(/iss=[^&]*/u, 'iss=https%3A%2F%2Flogin.example.org');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the start of a sign-in', () => {
  it('sends the person to the authorization endpoint with the code flow, PKCE with S256, and a fresh state and nonce', async () => {
    const provider = providerWith();
    const party = await partyOf(provider);

    const first = await party.signInStarted();
    const second = await party.signInStarted();
    const asked = new URL(first.authorizationUrl);

    expect(`${asked.origin}${asked.pathname}`).toBe(`${issuer}/authorize`);
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      client_id: provider.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      code_challenge: createHash('sha256').update(first.pending.codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: first.pending.state,
      nonce: first.pending.nonce,
    });
    const drawn = [first, second].flatMap(({ pending }) => [pending.state, pending.nonce, pending.codeVerifier]);
    expect(new Set(drawn).size).toBe(6);
    expect([party.issuer, party.redirectUri]).toEqual([issuer, redirectUri]);
  });
});

describe('the end of a sign-in, as the ID Token is checked', () => {
  it('signs the person in as the issuer and the subject of the ID Token, as given', async () => {
    expect(await signedInThrough(providerWith())).toEqual(signedIn);
  });

  it('refuses an answer whose state is not the one its sign-in started with', async () => {
    const provider = providerWith();
    const party = await partyOf(provider);
    const { authorizationUrl, pending } = await party.signInStarted();
    const other = await party.signInStarted();

    expect(await party.signInFinished(provider.signedIn(authorizationUrl, subject), other.pending)).toEqual({
      failed: 'OAUTH_INVALID_RESPONSE',
    });
    expect(await party.signInFinished(provider.signedIn(authorizationUrl, subject), pending)).toEqual(signedIn);
  });

  it('refuses an ID Token that names another nonce, another client or another issuer', async () => {
    const claims: readonly Claims[] = [
      { nonce: 'another-nonce' },
      { aud: 'another-client' },
      { iss: 'https://login.example.org' },
    ];

    const refusals = await Promise.all(claims.map((idToken) => signedInThrough(providerWith({ idToken }))));

    expect(new Set(refusals.map((refusal) => JSON.stringify(refusal)))).toEqual(
      new Set([JSON.stringify({ failed: 'OAUTH_JWT_CLAIM_COMPARISON_FAILED' })]),
    );
  });

  it('refuses an answer that names another issuer, or none where the provider declares that it names one', async () => {
    const provider = providerWith();
    const silent = providerWith({ metadata: { authorization_response_iss_parameter_supported: false } });

    expect([
      await signedInThrough(provider, {}, withAnotherIss),
      await signedInThrough(provider, {}, withoutIss),
    ]).toEqual([{ failed: 'OAUTH_INVALID_RESPONSE' }, { failed: 'OAUTH_INVALID_RESPONSE' }]);
    expect(await signedInThrough(silent, {}, withoutIss)).toEqual(signedIn);
  });
});

describe('the end of a sign-in, as the person is named', () => {
  it('answers the name and the email of the ID Token where each is text, and no other claim of it', async () => {
    const named = providerWith({ idToken: { name: 'Ada Lovelace', email: 'ada@example.com', groups: ['admins'] } });
    const numbered = providerWith({ idToken: { name: 1815, email: ['ada@example.com'] } });

    expect([await signedInThrough(named), await signedInThrough(numbered)]).toEqual([
      { ...signedIn, claims: { name: 'Ada Lovelace', email: 'ada@example.com' } },
      signedIn,
    ]);
  });
});

describe('the end of a sign-in, as time passes', () => {
  it('takes an ID Token up to 60 seconds after it expired, and none later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-18T09:00:00Z'));
    const seconds = Math.floor(Date.now() / 1000);
    const expiredBy = (after: number) => providerWith({ idToken: { iat: seconds - 600, exp: seconds - after } });

    expect([await signedInThrough(expiredBy(50)), await signedInThrough(expiredBy(70))]).toEqual([
      signedIn,
      { failed: 'OAUTH_JWT_TIMESTAMP_CHECK_FAILED' },
    ]);
  });

  it("reads the provider's keys again for a key it does not know, at most once a minute", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse('2026-11-18T09:00:00Z');
    vi.setSystemTime(start);
    const provider = providerWith();
    const party = await partyOf(provider);

    const before = await signedInBy(party, provider);
    provider.rotate();
    vi.setSystemTime(start + 30_000);
    const soonAfter = await signedInBy(party, provider);
    const readsSoonAfter = provider.keySetReads();
    vi.setSystemTime(start + 61_000);
    const aMinuteAfter = await signedInBy(party, provider);

    expect([before, soonAfter, aMinuteAfter]).toEqual([signedIn, { failed: 'OAUTH_KEY_SELECTION_FAILED' }, signedIn]);
    expect([readsSoonAfter, provider.keySetReads()]).toEqual([1, 2]);
  });
});

describe('the end of a sign-in the provider refuses', () => {
  it('answers the error code the provider refused the sign-in with, by the syntax of OAuth 2.0 alone', async () => {
    const provider = providerWith();
    const party = await partyOf(provider);
    const { authorizationUrl, pending } = await party.signInStarted();

    expect(await party.signInFinished(provider.refused(authorizationUrl, 'access_denied'), pending)).toEqual({
      refusedByTheProvider: 'access_denied',
    });
    expect(await party.signInFinished(provider.refused(authorizationUrl, 'not "a code"'), pending)).toEqual({
      failed: 'OAUTH_AUTHORIZATION_RESPONSE_ERROR',
    });
  });

  it('answers the error code the token endpoint refused the code with, as for a wrong client secret', async () => {
    expect([
      await signedInThrough(providerWith(), { clientSecret: Redacted.make('another-secret') }),
      await signedInThrough(providerWith({ tokenError: 'unauthorized_client' })),
    ]).toEqual([{ refusedByTheProvider: 'invalid_client' }, { refusedByTheProvider: 'unauthorized_client' }]);
  });

  it('proves its code with the verifier of its own sign-in, and exchanges a code once', async () => {
    const provider = providerWith();
    const party = await partyOf(provider);
    const { authorizationUrl, pending } = await party.signInStarted();
    const answered = provider.signedIn(authorizationUrl, subject);
    const another = (await party.signInStarted()).pending;

    expect([
      await party.signInFinished(answered, { ...pending, codeVerifier: another.codeVerifier }),
      await party.signInFinished(answered, pending),
    ]).toEqual([{ refusedByTheProvider: 'invalid_grant' }, { refusedByTheProvider: 'invalid_grant' }]);
  });

  it('says when the token endpoint cannot be reached, and in the words of what it could not read', async () => {
    const elsewhere = providerWith({ metadata: { token_endpoint: 'https://tokens.example.org/token' } });

    const finished = await signedInThrough(elsewhere);

    expect(Object.keys(finished)).toEqual(['failed']);
    expect(Object.values(finished)).not.toContainEqual(expect.stringMatching(/^OAUTH_/u));
  });
});

function methodOf(token: Readonly<Request>, form: Readonly<URLSearchParams>): string {
  if (form.has('client_assertion')) {
    return 'client_secret_jwt';
  }
  return token.headers.has('authorization') ? 'client_secret_basic' : 'client_secret_post';
}

function observed(provider: FakeProvider): { readonly requests: ProviderRequests; readonly methods: string[] } {
  const methods: string[] = [];
  const fetch: ProviderRequests['fetch'] = async (request) => {
    methods.push(
      ...(request.url.endsWith('/token') ? [methodOf(request, new URLSearchParams(await request.clone().text()))] : []),
    );
    return provider.requests.fetch(request);
  };
  return { methods, requests: { fetch } };
}

async function methodUsed(
  declared?: readonly string[],
  asked?: RelyingPartySettings['tokenEndpointAuthMethod'],
): Promise<readonly unknown[]> {
  const provider = providerWith({ metadata: { token_endpoint_auth_methods_supported: declared } });
  const { requests, methods } = observed(provider);
  const party = await relyingPartyOf(settingsOf(provider, { tokenEndpointAuthMethod: asked }), requests);
  const { authorizationUrl, pending } = await party.signInStarted();
  const finished = await party.signInFinished(provider.signedIn(authorizationUrl, subject), pending);
  return [finished, ...methods];
}

describe("the client's authentication at the token endpoint", () => {
  it('is client_secret_basic where the provider declares it or declares none, then client_secret_post, then client_secret_jwt', async () => {
    expect([
      await methodUsed(),
      await methodUsed(['client_secret_post', 'client_secret_basic']),
      await methodUsed(['private_key_jwt', 'client_secret_post']),
      await methodUsed(['client_secret_jwt']),
    ]).toEqual([
      [signedIn, 'client_secret_basic'],
      [signedIn, 'client_secret_basic'],
      [signedIn, 'client_secret_post'],
      [signedIn, 'client_secret_jwt'],
    ]);
  });

  it('is the method asked for, where the provider declares it', async () => {
    expect([
      await methodUsed(['client_secret_post', 'client_secret_basic'], 'client_secret_basic'),
      await methodUsed(['client_secret_basic', 'client_secret_post', 'client_secret_jwt'], 'client_secret_jwt'),
    ]).toEqual([
      [signedIn, 'client_secret_basic'],
      [signedIn, 'client_secret_jwt'],
    ]);
  });

  it('is refused with a wrong secret, whichever the method', async () => {
    const provider = providerWith({ metadata: { token_endpoint_auth_methods_supported: ['client_secret_jwt'] } });

    expect(await signedInThrough(provider, { clientSecret: Redacted.make('another-secret') })).toEqual({
      refusedByTheProvider: 'invalid_client',
    });
  });
});
