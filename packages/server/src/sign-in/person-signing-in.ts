import { signInScopes } from '@on.auto/identity';
import { personIdOf } from '@on.auto/openid-connect';
import { browserAt, type Browser } from '@on.auto/openid-connect/testing';
import { allPermissions, normalizedPermissions } from '@on.auto/operations';

import { providerOverHttps } from './issuer-over-https.ts';
import {
  allowed,
  backFrom,
  exchanged,
  locationOf,
  publicUrl,
  registered,
  signedInAs,
  studio,
  toTheProvider,
} from './signing-in.ts';

interface SignedInCarrying {
  readonly opened: Response;
  readonly finished: Response;
  readonly stillCarried: boolean;
}

export interface PersonSigningIn {
  readonly publicUrl: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly personOf: (who: string) => string;
  readonly tokenAt: (origin: string, who: string, scopes?: readonly string[]) => Promise<string>;
  readonly agentTokenAt: (origin: string, who: string) => Promise<string>;
  readonly signedInCarrying: (origin: string, who: string, link: string) => Promise<SignedInCarrying>;
  readonly signedInWithTheCookie: (origin: string, who: string, cookie: string) => Promise<Response>;
}

const invitationCookie = '__Host-Http-invitation';

const studioAsked = {
  clientId: studio.clientId,
  redirectUri: studio.redirectUri,
  scope: ['openid', ...signInScopes].join(' '),
};

export async function personSigningIn(): Promise<PersonSigningIn> {
  const provider = await providerOverHttps('/tenant/v2.0');
  const studioSignedIn = async (browser: Browser, who: string) => {
    const upstream = await toTheProvider(browser, studioAsked);
    const back = await backFrom(browser, provider.signedIn(upstream, who));
    return back.headers.has('location') ? browser.at(locationOf(back)) : back;
  };
  return {
    publicUrl,
    environment: {
      PUBLIC_URL: publicUrl,
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: provider.clientId,
      OIDC_CLIENT_SECRET: provider.clientSecret,
    },
    personOf: (who) => personIdOf({ issuer: provider.issuer, subject: who }),
    tokenAt: async (origin, who, scopes = signInScopes) => {
      const browser = browserAt(origin, publicUrl);
      const asked = { ...studioAsked, scope: ['openid', ...scopes].join(' ') };
      const upstream = await toTheProvider(browser, asked);
      const resumed = await browser.at(locationOf(await backFrom(browser, provider.signedIn(upstream, who))));
      return exchanged(browser, String(new URL(locationOf(resumed)).searchParams.get('code')), asked);
    },
    signedInCarrying: async (origin, who, link) => {
      const browser = browserAt(origin, publicUrl);
      const opened = await browser.at(link);
      const finished = await studioSignedIn(browser, who);
      return { opened, finished, stillCarried: browser.cookies.has(invitationCookie) };
    },
    signedInWithTheCookie: (origin, who, cookie) => {
      const browser = browserAt(origin, publicUrl);
      browser.cookieSet(invitationCookie, cookie);
      return studioSignedIn(browser, who);
    },
    agentTokenAt: async (origin, who) => {
      const browser = browserAt(origin, publicUrl);
      const clientId = await registered(browser);
      const consent = await signedInAs(
        { provider },
        browser,
        { clientId, scope: normalizedPermissions(allPermissions).join(' ') },
        who,
      );
      return exchanged(browser, await allowed(browser, locationOf(consent)), { clientId });
    },
  };
}
