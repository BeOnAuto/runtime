import { middlewareBesideTheApi, type PageStyle } from '@on.auto/api';
import { signInScopes, studioLinkOf, type IdentityService, type PageSettings } from '@on.auto/identity';
import type { AuthStore } from '@on.auto/openid-connect';
import type { AuthorizationServer, StudioClient } from '@on.auto/openid-connect/authorization-server';
import type { SecretStore } from '@on.auto/secrets';

import { callbackPath } from '../settings/openid-connect-settings.ts';
import type { CompanySignIn } from './company-client.ts';
import { interactionSignInOf, keptIn, signingInOf, type Logged, type SignInStore } from './interaction-sign-in.ts';
import { claimsIn, identityServiceOf, keptSecretsOf } from './issued-tokens.ts';
import { signInPagesOf } from './sign-in-pages.ts';

export interface SignInServing {
  readonly identityService: IdentityService;
  readonly answers: AuthorizationServer['answers'];
  readonly listener: AuthorizationServer['listener'];
}

export interface SignInServed extends SignInStore, Partial<Pick<AuthStore, 'providerRows' | 'signingKeyRows'>> {
  readonly signingSecrets?: Pick<SecretStore, 'keep' | 'read' | 'forget'>;
}

export interface SignInServingParts {
  readonly logged: Logged;
  readonly served: SignInServed;
  readonly pages: PageSettings;
  readonly pageStyle: PageStyle;
  readonly studio: StudioClient;
}

export type SignInServingOf = (parts: SignInServingParts) => Promise<SignInServing>;

export function signInServingOf(signIn?: CompanySignIn): SignInServingOf | undefined {
  if (signIn === undefined) {
    return undefined;
  }
  return async (parts) => {
    const studioOpenedAt = studioLinkOf(parts.pages.studio, {
      ownOrigin: signIn.publicUrl,
      openedFrom: 'runtime-page',
      installId: undefined,
    });
    const signingIn = await signingInOf(signIn, { logged: parts.logged, served: parts.served, studioOpenedAt });
    const { authorizationServerOf, signingKeyOf } = await import('@on.auto/openid-connect/authorization-server');
    const { served, pages, pageStyle, studio } = parts;
    const server = authorizationServerOf(
      { issuer: signIn.publicUrl, studio, resourceScopes: signInScopes },
      {
        rows: keptIn(served.providerRows),
        signingKey: await signingKeyOf(keptIn(served.signingKeyRows), keptSecretsOf(keptIn(served.signingSecrets))),
        claimsOf: claimsIn(signingIn.people, signingIn.enrolling),
        middleware: middlewareBesideTheApi({ ...pages, publicUrl: signIn.publicUrl }),
        signIn: interactionSignInOf(signingIn),
        pages: signInPagesOf(pageStyle),
        signInCallbackPath: callbackPath,
      },
    );
    return {
      identityService: identityServiceOf(signIn.publicUrl, server.accessTokenOf),
      answers: server.answers,
      listener: server.listener,
    };
  };
}
