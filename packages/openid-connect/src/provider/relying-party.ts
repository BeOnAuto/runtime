import { Schema, type Redacted } from 'effect';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  ResponseBodyError,
  WWWAuthenticateChallengeError,
} from 'openid-client';

import { usableProviderOf, type PendingChecks, type SignInsAs } from './client-configuration.ts';
import type { ClientAuthenticationMethod } from './provider-metadata.ts';
import {
  failureOf,
  providerRequestsOverTheNetwork,
  refusalCodeOf,
  type ProviderRequests,
} from './provider-requests.ts';
import type { TokensHeld } from './sign-in-tokens.ts';
import { standardClaimsIn, type StandardClaims } from './standard-claims.ts';

export interface RequiredClaim {
  readonly claim: string;
  readonly requiredValue?: string;
}

export interface RelyingPartySettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly scopes: readonly string[];
  readonly tokenEndpointAuthMethod: ClientAuthenticationMethod | undefined;
  readonly redirectUri: string;
  readonly requiredClaim?: Pick<RequiredClaim, 'claim'> | undefined;
}

export interface PendingSignIn extends PendingChecks {
  readonly clientId?: string;
}

type Prompt = 'select_account';

export interface SignInAsked {
  readonly prompt?: Prompt;
}

export interface StartedSignIn {
  readonly authorizationUrl: string;
  readonly pending: PendingSignIn;
}

export interface SignedInPerson {
  readonly issuer: string;
  readonly subject: string;
}

export interface SignedInWith {
  readonly signedIn: SignedInPerson;
  readonly claims: StandardClaims;
  readonly valueOfTheRequiredClaim?: string;
  readonly held?: TokensHeld;
}

export type FinishedSignIn = SignedInWith | { readonly refusedByTheProvider: string } | { readonly failed: string };

export interface RelyingParty {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly signInStarted: (asked?: SignInAsked) => Promise<StartedSignIn>;
  readonly signInFinished: (callbackQuery: string, pending: PendingSignIn) => Promise<FinishedSignIn>;
}

const IdTokenClaims = Schema.Struct({ iss: Schema.String, sub: Schema.String });

const decodeClaims = Schema.decodeUnknownSync(IdTokenClaims);

const unauthorized = 401;

function isTheClientRefused(error: unknown): boolean {
  return (
    (error instanceof ResponseBodyError && error.error === 'invalid_client') ||
    (error instanceof WWWAuthenticateChallengeError && error.status === unauthorized)
  );
}

function requiredClaimIn(
  claims: unknown,
  required: RelyingPartySettings['requiredClaim'],
): { readonly valueOfTheRequiredClaim?: string } {
  const fields = new Object(claims);
  const value: unknown =
    required !== undefined && Object.hasOwn(fields, required.claim) ? Reflect.get(fields, required.claim) : undefined;
  return typeof value === 'string' ? { valueOfTheRequiredClaim: value } : {};
}

function finishedAfter(error: unknown): FinishedSignIn {
  const refusal = refusalCodeOf(error);
  return refusal === undefined ? { failed: failureOf(error) } : { refusedByTheProvider: refusal };
}

type SignInSettings = Pick<RelyingPartySettings, 'issuer' | 'redirectUri' | 'scopes' | 'requiredClaim'>;

function authorizationParametersOf(
  { redirectUri, scopes }: SignInSettings,
  { state, nonce }: PendingSignIn,
  codeChallenge: string,
  asked: SignInAsked | undefined,
): Readonly<Record<string, string>> {
  return {
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    ...(asked?.prompt === undefined ? {} : { prompt: asked.prompt }),
  };
}

function freshPendingSignIn(): PendingSignIn {
  return { state: randomState(), nonce: randomNonce(), codeVerifier: randomPKCECodeVerifier() };
}

interface StartingAs {
  readonly signIns: SignInsAs;
  readonly noted?: string;
}

interface FinishingAs {
  readonly signIns: SignInsAs;
  readonly refused: () => Promise<void>;
}

export interface SigningInAs {
  readonly starting: () => Promise<StartingAs>;
  readonly finishing: (pending: PendingSignIn) => Promise<FinishingAs | undefined>;
}

const notItsClient = 'the client its sign-in began with is not one this server keeps';

function notedBy({ noted }: StartingAs): Pick<PendingSignIn, 'clientId'> {
  return noted === undefined ? {} : { clientId: noted };
}

async function finishedAs(
  { requiredClaim }: SignInSettings,
  { signIns, refused }: FinishingAs,
  callbackQuery: string,
  pending: PendingSignIn,
): Promise<FinishedSignIn> {
  try {
    const { claims, held } = await signIns.codeExchanged(callbackQuery, pending);
    const { iss, sub } = decodeClaims(claims);
    return {
      signedIn: { issuer: iss, subject: sub },
      claims: standardClaimsIn(claims),
      ...requiredClaimIn(claims, requiredClaim),
      ...(held === undefined ? {} : { held }),
    };
  } catch (error) {
    if (isTheClientRefused(error)) {
      await refused();
    }
    return finishedAfter(error);
  }
}

export function relyingPartyAs(settings: SignInSettings, signingInAs: SigningInAs): RelyingParty {
  const { issuer, redirectUri } = settings;
  return {
    issuer,
    redirectUri,
    signInStarted: async (asked) => {
      const starting = await signingInAs.starting();
      const pending = { ...freshPendingSignIn(), ...notedBy(starting) };
      const challenge = await calculatePKCECodeChallenge(pending.codeVerifier);
      const authorizationUrl = starting.signIns.authorizationUrlOf(
        authorizationParametersOf(settings, pending, challenge, asked),
      );
      return { authorizationUrl, pending };
    },
    signInFinished: async (callbackQuery, pending) => {
      const finishing = await signingInAs.finishing(pending);
      return finishing === undefined
        ? { failed: notItsClient }
        : finishedAs(settings, finishing, callbackQuery, pending);
    },
  };
}

const nothingToDo = (): Promise<void> => Promise.resolve();

export async function relyingPartyOf(
  settings: RelyingPartySettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): Promise<RelyingParty> {
  const provider = await usableProviderOf(settings, requests);
  const { clientId, clientSecret } = settings;
  const signIns = provider.signInsAs({ clientId, clientSecret, tokenEndpointAuthMethod: provider.method });
  return relyingPartyAs(settings, {
    starting: () => Promise.resolve({ signIns }),
    finishing: () => Promise.resolve({ signIns, refused: nothingToDo }),
  });
}
