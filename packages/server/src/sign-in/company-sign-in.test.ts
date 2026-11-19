import { UnusableIdentityProviderError, type RelyingParty } from '@on.auto/openid-connect';
import type { Asking, Browser, FakeProviderOptions } from '@on.auto/openid-connect/testing';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { signInServingOf } from './company-sign-in.ts';
import {
  allowed,
  backFrom,
  authorizationAskedBy,
  locationOf,
  publicUrl,
  registered,
  signedInAs,
  signingIn,
  startOf,
  studio,
  subject,
  toTheProvider,
} from './signing-in.ts';

function setCookieNamed(setCookies: readonly string[], name: string): string | undefined {
  return setCookies.find((cookie) => cookie.startsWith(`${name}=`));
}

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, as its own authorization server', () => {
  it('asks the person to allow an agent on its own page once they signed in at the provider, keeping the sign-in in its own cookies', async () => {
    const signing = await signingIn();
    const browser = signing.aBrowser();
    const clientId = await registered(browser);

    const upstream = await toTheProvider(browser, { clientId });
    const consent = locationOf(await signedInAs(signing, browser, { clientId }, subject));
    const page = await browser.at(consent);
    const code = await allowed(browser, consent);

    expect(signing.server().signIn).toEqual({ issuer: signing.provider.issuer, publicUrl });
    expect(upstream.startsWith(`${signing.provider.issuer}/authorize?`)).toBe(true);
    expect(new URL(upstream).searchParams.get('redirect_uri')).toBe(`${publicUrl}/auth/oidc/callback`);
    expect([page.status, page.headers.get('content-security-policy')]).toEqual([
      200,
      expect.stringContaining(`form-action 'self' http://127.0.0.1:7777`),
    ]);
    expect(code).not.toBe('');
    expect(setCookieNamed(browser.setCookies, '__Host-Http-sign-in')).toMatch(
      /; path=\/; .*samesite=lax; secure; httponly/iu,
    );
    expect(setCookieNamed(browser.setCookies, '__Host-Http-session')).toMatch(
      /; path=\/; .*samesite=lax; secure; httponly/iu,
    );
  });

  it('never asks the person to allow Studio, whose redirect it takes from STUDIO_ORIGIN alone', async () => {
    const signing = await signingIn();
    const browser = signing.aBrowser();
    const asked = { clientId: studio.clientId, redirectUri: studio.redirectUri, scope: 'openid org:read' };
    const elsewhere = { ...asked, redirectUri: 'https://studio.on.auto/elsewhere' };

    const back = await signedInAs(signing, browser, asked, subject);
    const refused = await browser.at(authorizationAskedBy(elsewhere));
    const refusal: unknown = await refused.json();

    expect(locationOf(back).startsWith(`${studio.redirectUri}?code=`)).toBe(true);
    expect([refused.status, refusal]).toMatchObject([400, { error: 'invalid_redirect_uri' }]);
  });
});

describe('the routes of the authorization server, beside the API', () => {
  it('carry the request id and the security headers of the API, refuse an origin it does not allow, and let Studio reach a private network', async () => {
    const signing = await signingIn();

    const metadata = await signing.at('/.well-known/openid-configuration');
    const foreign = await signing.at('/oauth/token', {
      method: 'POST',
      headers: { origin: 'https://elsewhere.example' },
    });
    const preflight = await signing.at('/oauth/token', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.on.auto',
        'access-control-request-method': 'POST',
        'access-control-request-private-network': 'true',
      },
    });

    expect([
      metadata.status,
      metadata.headers.has('x-request-id'),
      metadata.headers.get('x-content-type-options'),
    ]).toEqual([200, true, 'nosniff']);
    expect(await metadata.json()).toMatchObject({ issuer: publicUrl, token_endpoint: `${publicUrl}/oauth/token` });
    expect([foreign.status, preflight.status]).toEqual([403, 204]);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
  });
});

const inStudio = { clientId: studio.clientId, redirectUri: studio.redirectUri, scope: 'openid org:read' };

function originABrowserSends(page: Readonly<Response>, actionOrigin: string): string {
  const policy = String(page.headers.get('referrer-policy'))
    .split(',')
    .map((each) => each.trim())
    .at(-1);
  const withheld = policy === 'no-referrer' || (policy === 'same-origin' && actionOrigin !== publicUrl);
  return withheld ? 'null' : publicUrl;
}

interface PostedForm {
  readonly action: string;
  readonly asked: Asking;
}

async function formsOn(page: Readonly<Response>): Promise<readonly PostedForm[]> {
  const html = await page.text();
  return [...html.matchAll(/<form [^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gu)].map(
    ([, address = '', inside = '']: readonly string[]) => {
      const action = new URL(address, publicUrl);
      const fields = Object.fromEntries(
        [...inside.matchAll(/name="([^"]+)" value="([^"]*)"/gu)].map(([, name = '', value = '']: readonly string[]) => [
          name,
          value,
        ]),
      );
      return {
        action: `${action.pathname}${action.search}`,
        asked: {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: originABrowserSends(page, action.origin),
          },
          body: new URLSearchParams(fields).toString(),
        },
      };
    },
  );
}

interface Posted {
  readonly shownAs: string | undefined;
  readonly answer: Response;
}

async function postedAsABrowserWould(browser: Browser, page: Readonly<Response>, which = 0): Promise<Posted> {
  const form = (await formsOn(page))[which];
  const shownAs = page.headers.get('content-type')?.split(';')[0];
  return { shownAs, answer: await browser.at(String(form?.action), form?.asked) };
}

describe('the forms of the pages of the authorization server', () => {
  it('are taken when a browser posts them with the Origin their page lets it send: Allow, Deny, signing out and choosing another account', async () => {
    const signing = await signingIn();
    const [browser, switching] = [signing.aBrowser(), signing.aBrowser()];
    const clientId = await registered(browser);
    await signedInAs(signing, browser, inStudio, 'Ada');
    await signedInAs(signing, switching, inStudio, 'Ada');

    const toAllow = locationOf(await browser.at(authorizationAskedBy({ clientId })));
    const allowedNow = await postedAsABrowserWould(browser, await browser.at(toAllow));
    const toDeny = locationOf(await browser.at(authorizationAskedBy({ clientId, scope: 'org:read playbook:read' })));
    const deniedNow = await postedAsABrowserWould(browser, await browser.at(toDeny), 1);
    const signingOut = await browser.at(`/session/end?client_id=${encodeURIComponent(studio.clientId)}`);
    const signedOutNow = await postedAsABrowserWould(browser, signingOut);
    const another = await toTheProvider(switching, { ...inStudio, prompt: 'select_account' });
    const switched = await backFrom(switching, signing.provider.signedIn(another, 'Priya'));
    const switchedNow = await postedAsABrowserWould(switching, await switching.at(locationOf(switched)));

    const posted = [allowedNow, deniedNow, signedOutNow, switchedNow];
    expect(posted.map(({ shownAs, answer }) => [shownAs, answer.status])).toEqual(
      Array.from({ length: 4 }, () => ['text/html', 303]),
    );
  });
});

function clientIdOf(upstream: string): string | null {
  return new URL(upstream).searchParams.get('client_id');
}

describe('a runtime whose people sign in through the identity provider OIDC_ISSUER names, with no client given', () => {
  it('registers itself as it starts, signs people in as that client, and keeps using it after a restart', async () => {
    const signing = await signingIn({ registersItself: true });
    const browser = signing.aBrowser();
    const clientId = await registered(browser);
    const asked = signing.provider.registrationsAsked().length;

    const before = await toTheProvider(browser, { clientId });
    await signing.restarted();
    const after = await toTheProvider(signing.aBrowser(), { clientId });

    expect([asked, signing.provider.registrationsAsked().length]).toEqual([1, 1]);
    expect(clientIdOf(after)).toBe(clientIdOf(before));
    expect(clientIdOf(after)).not.toBe(signing.provider.clientId);
  });

  it('registers anew once the provider refuses the client it used, so the person signs in at the next try', async () => {
    const signing = await signingIn({ registersItself: true });
    const browser = signing.aBrowser();
    const clientId = await registered(browser);
    signing.provider.withdraw(String(clientIdOf(await toTheProvider(browser, { clientId }))));

    const upstream = await toTheProvider(browser, { clientId });
    const refused = await backFrom(browser, signing.provider.signedIn(upstream, subject));
    const again = await signedInAs(signing, signing.aBrowser(), { clientId }, subject);

    expect([refused.status, again.status]).toEqual([400, 303]);
    expect(signing.provider.registrationsAsked()).toHaveLength(2);
  });
});

describe('the start of a runtime whose people sign in through OIDC_ISSUER', () => {
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

const relyingParty: RelyingParty = {
  issuer: 'https://login.example.com/tenant/v2.0',
  redirectUri: 'https://auto.example.com/auth/oidc/callback',
  signInStarted: () => Promise.reject(new Error('Not asked')),
  signInFinished: () => Promise.reject(new Error('Not asked')),
};

describe('the sign-in of a composition that opens no sign-in store', () => {
  it('is refused as a defect of that composition', async () => {
    const serving = signInServingOf({ relyingParty, publicUrl, requiredClaim: undefined });
    const parts = {
      logged: Function.constVoid,
      served: {},
      pages: { studio: { origin: 'https://studio.on.auto', served: false }, allowedOrigins: [] },
      studio,
      pageStyle: { head: () => '', readOnlyHeaders: {}, controlHeaders: {}, formHeaders: () => ({}) },
    };

    await expect(serving?.(parts)).rejects.toThrow(Error);
    expect(signInServingOf()).toBeUndefined();
  });
});
