import { Data, Redacted, Result } from 'effect';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  clockTolerance,
  ClientSecretBasic,
  ClientSecretJwt,
  ClientSecretPost,
  Configuration,
  customFetch,
  enableNonRepudiationChecks,
  type ClientAuth,
} from 'openid-client';

import type { RelyingPartyClient } from './client-registration.ts';
import { providerMetadataOf, type ClientAuthenticationMethod } from './provider-metadata.ts';
import { boundedFetchOf, providerAnswerSeconds, type ProviderRequests } from './provider-requests.ts';
import { tokensHeldBy, type EndpointsDeclared, type TokensHeld } from './sign-in-tokens.ts';
import { textClaim } from './standard-claims.ts';

export const leewaySeconds = 60;

export class UnusableIdentityProviderError extends Data.TaggedError('UnusableIdentityProviderError')<{
  readonly message: string;
}> {}

export interface PendingChecks {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

interface CodeExchanged {
  readonly claims: unknown;
  readonly held: TokensHeld | undefined;
}

export interface SignInsAs {
  readonly authorizationUrlOf: (parameters: Readonly<Record<string, string>>) => string;
  readonly codeExchanged: (callbackQuery: string, pending: PendingChecks) => Promise<CodeExchanged>;
}

export interface UsableProvider {
  readonly method: ClientAuthenticationMethod;
  readonly registrationEndpoint: string | undefined;
  readonly signInsAs: (client: RelyingPartyClient) => SignInsAs;
}

export interface ProviderSettings {
  readonly issuer: string;
  readonly tokenEndpointAuthMethod: ClientAuthenticationMethod | undefined;
  readonly redirectUri: string;
}

const authenticationOf: Record<ClientAuthenticationMethod, (secret: string) => ClientAuth> = {
  client_secret_basic: ClientSecretBasic,
  client_secret_post: ClientSecretPost,
  client_secret_jwt: (secret) => ClientSecretJwt(secret),
};

function callbackAt(redirectUri: string, callbackQuery: string): URL {
  const callback = new URL(redirectUri);
  callback.search = callbackQuery;
  return callback;
}

function checksOf({ state, nonce, codeVerifier }: PendingChecks) {
  return { pkceCodeVerifier: codeVerifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true };
}

function signInsOf(
  configuration: Readonly<Configuration>,
  redirectUri: string,
  declares: EndpointsDeclared,
): SignInsAs {
  return {
    authorizationUrlOf: (parameters) => buildAuthorizationUrl(configuration, parameters).href,
    codeExchanged: async (callbackQuery, pending) => {
      const tokens = await authorizationCodeGrant(
        configuration,
        callbackAt(redirectUri, callbackQuery),
        checksOf(pending),
      );
      const claims = tokens.claims();
      const read = {
        subject: String(Reflect.get(new Object(claims), 'sub')),
        named: textClaim(claims, 'name').name !== undefined,
      };
      return { claims, held: tokensHeldBy(configuration, declares, tokens, read) };
    },
  };
}

export async function usableProviderOf(
  { issuer, tokenEndpointAuthMethod, redirectUri }: ProviderSettings,
  requests: ProviderRequests,
): Promise<UsableProvider> {
  const read = await providerMetadataOf(issuer, tokenEndpointAuthMethod, requests);
  if (Result.isFailure(read)) {
    throw new UnusableIdentityProviderError({
      message: `The identity provider at ${issuer} cannot be used: ${read.failure}`,
    });
  }
  const { server, method, registrationEndpoint, declares } = read.success;
  return {
    method,
    registrationEndpoint,
    signInsAs: ({ clientId, clientSecret, tokenEndpointAuthMethod: proven }) => {
      const authentication = authenticationOf[proven](Redacted.value(clientSecret));
      const configuration = new Configuration(server, clientId, { [clockTolerance]: leewaySeconds }, authentication);
      configuration[customFetch] = boundedFetchOf(requests);
      configuration.timeout = providerAnswerSeconds;
      enableNonRepudiationChecks(configuration);
      return signInsOf(configuration, redirectUri, declares);
    },
  };
}
