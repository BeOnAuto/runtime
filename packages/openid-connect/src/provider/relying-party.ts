import { Data, Redacted, Result, Schema } from 'effect';
import {
  AuthorizationResponseError,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  clockTolerance,
  ClientSecretBasic,
  ClientSecretJwt,
  ClientSecretPost,
  Configuration,
  customFetch,
  enableNonRepudiationChecks,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  ResponseBodyError,
  type ClientAuth,
} from 'openid-client';

import { providerMetadataOf, type ClientAuthenticationMethod } from './provider-metadata.ts';
import {
  boundedFetchOf,
  failureOfAnAnswer,
  providerAnswerSeconds,
  providerRequestsOverTheNetwork,
  type ProviderRequests,
} from './provider-requests.ts';

export const leewaySeconds = 60;

export interface RelyingPartySettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly scopes: readonly string[];
  readonly tokenEndpointAuthMethod: ClientAuthenticationMethod | undefined;
  readonly redirectUri: string;
}

export interface PendingSignIn {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface StartedSignIn {
  readonly authorizationUrl: string;
  readonly pending: PendingSignIn;
}

export interface SignedInPerson {
  readonly issuer: string;
  readonly subject: string;
}

export interface StandardClaims {
  readonly name?: string;
  readonly email?: string;
}

export type FinishedSignIn =
  | { readonly signedIn: SignedInPerson; readonly claims: StandardClaims }
  | { readonly refusedByTheProvider: string }
  | { readonly failed: string };

export interface RelyingParty {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly signInStarted: () => Promise<StartedSignIn>;
  readonly signInFinished: (callbackQuery: string, pending: PendingSignIn) => Promise<FinishedSignIn>;
}

export class UnusableIdentityProviderError extends Data.TaggedError('UnusableIdentityProviderError')<{
  readonly message: string;
}> {}

const authenticationOf: Record<ClientAuthenticationMethod, (secret: string) => ClientAuth> = {
  client_secret_basic: ClientSecretBasic,
  client_secret_post: ClientSecretPost,
  client_secret_jwt: (secret) => ClientSecretJwt(secret),
};

const IdTokenClaims = Schema.Struct({ iss: Schema.String, sub: Schema.String });

const decodeClaims = Schema.decodeUnknownSync(IdTokenClaims);

const codeOfAnError = /^[\u0020\u0021\u0023-\u005B\u005D-\u007E]+$/u;

function refusalCodeOf(error: unknown): string | undefined {
  const isRefusal = error instanceof AuthorizationResponseError || error instanceof ResponseBodyError;
  return isRefusal && codeOfAnError.test(error.error) ? error.error : undefined;
}

function textClaim(claims: object, name: keyof StandardClaims): StandardClaims {
  const value: unknown = Reflect.get(claims, name);
  return typeof value === 'string' ? { [name]: value } : {};
}

function standardClaimsIn(claims: unknown): StandardClaims {
  const fields = new Object(claims);
  return { ...textClaim(fields, 'name'), ...textClaim(fields, 'email') };
}

function codeOf(error: unknown): string {
  return String(Reflect.get(new Object(error), 'code'));
}

function finishedAfter(error: unknown): FinishedSignIn {
  const refusal = refusalCodeOf(error);
  if (refusal !== undefined) {
    return { refusedByTheProvider: refusal };
  }
  return { failed: failureOfAnAnswer(error) ?? codeOf(error) };
}

async function configurationOf(settings: RelyingPartySettings, requests: ProviderRequests): Promise<Configuration> {
  const { issuer, clientId, clientSecret, tokenEndpointAuthMethod } = settings;
  const read = await providerMetadataOf(issuer, tokenEndpointAuthMethod, requests);
  if (Result.isFailure(read)) {
    throw new UnusableIdentityProviderError({
      message: `The identity provider at ${issuer} cannot be used: ${read.failure}`,
    });
  }
  const { server, method } = read.success;
  const authentication = authenticationOf[method](Redacted.value(clientSecret));
  const configuration = new Configuration(server, clientId, { [clockTolerance]: leewaySeconds }, authentication);
  configuration[customFetch] = boundedFetchOf(requests);
  configuration.timeout = providerAnswerSeconds;
  enableNonRepudiationChecks(configuration);
  return configuration;
}

function authorizationParametersOf(
  { redirectUri, scopes }: RelyingPartySettings,
  { state, nonce }: PendingSignIn,
  codeChallenge: string,
): Readonly<Record<string, string>> {
  return {
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  };
}

function callbackAt(redirectUri: string, callbackQuery: string): URL {
  const callback = new URL(redirectUri);
  callback.search = callbackQuery;
  return callback;
}

function checksOf({ state, nonce, codeVerifier }: PendingSignIn) {
  return { pkceCodeVerifier: codeVerifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true };
}

function freshPendingSignIn(): PendingSignIn {
  return { state: randomState(), nonce: randomNonce(), codeVerifier: randomPKCECodeVerifier() };
}

export async function relyingPartyOf(
  settings: RelyingPartySettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): Promise<RelyingParty> {
  const configuration = await configurationOf(settings, requests);
  const { issuer, redirectUri } = settings;
  return {
    issuer,
    redirectUri,
    signInStarted: async () => {
      const pending = freshPendingSignIn();
      const challenge = await calculatePKCECodeChallenge(pending.codeVerifier);
      const authorizationUrl = buildAuthorizationUrl(
        configuration,
        authorizationParametersOf(settings, pending, challenge),
      );
      return { authorizationUrl: authorizationUrl.href, pending };
    },
    signInFinished: async (callbackQuery, pending) => {
      try {
        const tokens = await authorizationCodeGrant(
          configuration,
          callbackAt(redirectUri, callbackQuery),
          checksOf(pending),
        );
        const claims = tokens.claims();
        const { iss, sub } = decodeClaims(claims);
        return { signedIn: { issuer: iss, subject: sub }, claims: standardClaimsIn(claims) };
      } catch (error) {
        return finishedAfter(error);
      }
    },
  };
}
