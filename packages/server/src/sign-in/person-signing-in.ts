import { signInScopes } from '@on.auto/identity';
import { personIdOf } from '@on.auto/openid-connect';
import { browserAt } from '@on.auto/openid-connect/testing';

import { providerOverHttps } from './issuer-over-https.ts';
import { backFrom, exchanged, locationOf, publicUrl, studio, toTheProvider } from './signing-in.ts';

export interface PersonSigningIn {
  readonly publicUrl: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly personOf: (who: string) => string;
  readonly tokenAt: (origin: string, who: string, scopes?: readonly string[]) => Promise<string>;
}

export async function personSigningIn(): Promise<PersonSigningIn> {
  const provider = await providerOverHttps('/tenant/v2.0');
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
      const asked = {
        clientId: studio.clientId,
        redirectUri: studio.redirectUri,
        scope: ['openid', ...scopes].join(' '),
      };
      const upstream = await toTheProvider(browser, asked);
      const resumed = await browser.at(locationOf(await backFrom(browser, provider.signedIn(upstream, who))));
      return exchanged(browser, String(new URL(locationOf(resumed)).searchParams.get('code')), asked);
    },
  };
}
