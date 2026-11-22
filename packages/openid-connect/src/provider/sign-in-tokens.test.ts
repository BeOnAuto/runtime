import { Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeProvider, type Claims, type FakeProvider } from '../testing/fake-provider.ts';
import { answerAt, type ProviderRequests } from './provider-requests.ts';
import { relyingPartyOf, type FinishedSignIn } from './relying-party.ts';
import type { TokensHeld, TokensReleased } from './sign-in-tokens.ts';

const issuer = 'https://login.example.com/tenant/v2.0';

const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

async function finishedThrough(
  provider: FakeProvider,
  idToken: Claims = {},
  requests: ProviderRequests = provider.requests,
): Promise<FinishedSignIn> {
  const party = await relyingPartyOf(
    {
      issuer,
      clientId: provider.clientId,
      clientSecret: Redacted.make(provider.clientSecret),
      scopes: ['openid', 'profile', 'email'],
      tokenEndpointAuthMethod: undefined,
      redirectUri: 'https://auto.example.com/auth/oidc/callback',
    },
    requests,
  );
  const { authorizationUrl, pending } = await party.signInStarted();
  return party.signInFinished(provider.signedIn(authorizationUrl, subject, idToken), pending);
}

function heldIn(finished: FinishedSignIn): TokensHeld | undefined {
  return 'held' in finished ? finished.held : undefined;
}

function releasedBy(finished: FinishedSignIn, asked: boolean): Promise<TokensReleased | undefined> {
  return Promise.resolve(heldIn(finished)?.released(asked));
}

function answeredAt(
  provider: FakeProvider,
  paths: readonly string[],
  instead: ProviderRequests['fetch'],
): ProviderRequests {
  return {
    fetch: (request) =>
      paths.some((path) => request.url.endsWith(path)) ? instead(request) : provider.requests.fetch(request),
  };
}

const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');

async function unreadInTime(): Promise<string> {
  const unread = await answerAt({ fetch: () => Promise.reject(timeout) }, issuer, { headers: {}, method: 'GET' });
  return Result.isFailure(unread) ? unread.failure : 'answered';
}

describe('the name of a person, at the UserInfo endpoint the provider declares', () => {
  it('is read with the access token only where the ID Token carries none and the server asks for it, and of its answer only the name is taken', async () => {
    const provider = fakeProvider(issuer, { userInfo: { name: 'Ada Lovelace', email: 'another@example.com' } });
    const plainHttp = { userinfo_endpoint: 'http://login.example.com/userinfo' };

    const [asked, notAsked] = [await finishedThrough(provider), await finishedThrough(provider)];
    const named = await finishedThrough(provider, { name: 'Ada' });
    const undeclared = await finishedThrough(fakeProvider(issuer));
    const notHttps = await finishedThrough(fakeProvider(issuer, { userInfo: {}, metadata: plainHttp }));

    expect([await releasedBy(asked, true), await releasedBy(notAsked, false)]).toEqual([{ name: 'Ada Lovelace' }, {}]);
    expect([named, undeclared, notHttps].map((finished) => heldIn(finished))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(named).toEqual({ signedIn: { issuer, subject }, claims: { name: 'Ada' } });
    expect(provider.userInfoReads()).toBe(1);
  });

  it('is not taken from an answer about another person, nor where it is not text, and a failure says why', async () => {
    const another = fakeProvider(issuer, { userInfo: { sub: 'another', name: 'Grace Hopper' } });
    const numbered = fakeProvider(issuer, { userInfo: { name: 1815 } });
    const refusing = fakeProvider(issuer, { userInfo: { name: 'Ada Lovelace' } });
    const anotherBearer = answeredAt(refusing, ['/userinfo'], (request) =>
      refusing.requests.fetch(new Request(request, { headers: { authorization: 'Bearer another' } })),
    );

    expect([
      await releasedBy(await finishedThrough(another), true),
      await releasedBy(await finishedThrough(numbered), true),
      await releasedBy(await finishedThrough(refusing, {}, anotherBearer), true),
    ]).toEqual([
      { userInfoUnread: 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED' },
      {},
      { userInfoUnread: 'OAUTH_WWW_AUTHENTICATE_CHALLENGE' },
    ]);
  });
});

describe('whether the address of a person is verified', () => {
  it('is taken from the ID Token only where it holds the boolean true', async () => {
    const provider = fakeProvider(issuer);
    const address = { name: 'Ada', email: 'ada@example.com' };

    const finished = await Promise.all(
      [true, 'true', 1, false].map((verified) => finishedThrough(provider, { ...address, email_verified: verified })),
    );

    expect(finished).toEqual([
      { signedIn: { issuer, subject }, claims: { ...address, email_verified: true } },
      { signedIn: { issuer, subject }, claims: address },
      { signedIn: { issuer, subject }, claims: address },
      { signedIn: { issuer, subject }, claims: address },
    ]);
  });

  it('is read at the UserInfo endpoint only where the ID Token gives an address and does not say, and counts only for that address', async () => {
    const same = fakeProvider(issuer, { userInfo: { email: 'ada@example.com', email_verified: true } });
    const another = fakeProvider(issuer, { userInfo: { email: 'another@example.com', email_verified: true } });
    const saidAs = fakeProvider(issuer, { userInfo: { email: 'ada@example.com', email_verified: 'true' } });
    const address = { name: 'Ada', email: 'ada@example.com' };

    const released = [
      await releasedBy(await finishedThrough(same, address), true),
      await releasedBy(await finishedThrough(another, address), true),
      await releasedBy(await finishedThrough(saidAs, address), true),
    ];
    const answered = [
      await finishedThrough(same, { ...address, email_verified: false }),
      await finishedThrough(same, { name: 'Ada' }),
    ];

    expect(released).toEqual([{ email_verified: true }, {}, {}]);
    expect(answered.map((finished) => heldIn(finished))).toEqual([undefined, undefined]);
    expect(same.userInfoReads()).toBe(1);
  });
});

describe('a refresh token the provider sends unasked', () => {
  it('is handed back at the revocation endpoint the provider declares, after the name is read, whether or not the server asks for the name', async () => {
    const provider = fakeProvider(issuer, {
      userInfo: { name: 'Ada Lovelace' },
      refreshTokens: true,
      revocation: true,
    });

    const [admitted, refused] = [await finishedThrough(provider), await finishedThrough(provider)];
    const named = await finishedThrough(provider, { name: 'Ada' });

    expect([await releasedBy(admitted, true), await releasedBy(refused, false), await releasedBy(named, true)]).toEqual(
      [{ name: 'Ada Lovelace' }, {}, {}],
    );
    expect([provider.refreshTokensIssued().length, provider.userInfoReads()]).toEqual([3, 1]);
    expect(provider.tokensRevoked()).toEqual(provider.refreshTokensIssued());
  });

  it('is dropped where the provider declares no revocation endpoint, and the sign-in finishes as without one', async () => {
    const provider = fakeProvider(issuer, { refreshTokens: true });

    expect(await finishedThrough(provider)).toEqual({ signedIn: { issuer, subject }, claims: {} });
    expect([provider.refreshTokensIssued().length, provider.tokensRevoked()]).toEqual([1, []]);
  });

  it('is handed back as the client proves itself, and a refusal, or an endpoint that does not answer in time, is said and not thrown', async () => {
    const withdrawn = fakeProvider(issuer, { refreshTokens: true, revocation: true });
    const slow = fakeProvider(issuer, { userInfo: { name: 'Ada Lovelace' }, refreshTokens: true, revocation: true });
    const late = answeredAt(slow, ['/userinfo', '/revoke'], () => Promise.reject(timeout));
    const lateness = await unreadInTime();

    const finished = await finishedThrough(withdrawn);
    withdrawn.withdraw(withdrawn.clientId);

    expect([await releasedBy(finished, true), await releasedBy(await finishedThrough(slow, {}, late), true)]).toEqual([
      { notRevoked: 'invalid_client' },
      { userInfoUnread: lateness, notRevoked: lateness },
    ]);
    expect(withdrawn.tokensRevoked()).toEqual([]);
  });
});
