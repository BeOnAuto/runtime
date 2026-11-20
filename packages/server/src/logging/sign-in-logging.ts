import { defaultStudioOrigin, studioLinkOf, type StudioSettings } from '@on.auto/identity';
import { defaultOrg, type RequiredClaim } from '@on.auto/openid-connect';
import { Effect } from 'effect';

import type { OpenIdConnectSettings } from '../settings/openid-connect-settings.ts';

function requiredClaimWords(
  issuer: string,
  { claim, requiredValue }: NonNullable<OpenIdConnectSettings['requiredClaim']>,
): string {
  return requiredValue === undefined
    ? `Only a person whose ID Token from the identity provider at ${issuer} carries the claim ${claim} with the value recorded at the first sign-in can sign in. To give the value beforehand, set OIDC_REQUIRED_CLAIM as ${claim}=<value>`
    : `Only a person whose ID Token carries the claim ${claim} with the value OIDC_REQUIRED_CLAIM gives can sign in`;
}

function requiredClaimNotice({ issuer, requiredClaim }: OpenIdConnectSettings): Effect.Effect<void> {
  return requiredClaim === undefined
    ? Effect.void
    : Effect.logInfo(requiredClaimWords(issuer, requiredClaim)).pipe(
        Effect.annotateLogs({ oidc_issuer: issuer, oidc_required_claim: requiredClaim.claim }),
      );
}

function companySignInWords({ issuer, redirectUri, client }: OpenIdConnectSettings): string {
  const signedIn = `People sign in through the identity provider at ${issuer}.`;
  return client === undefined ? signedIn : `${signedIn} The redirect URI to register with it is ${redirectUri}`;
}

const signInByDefaultWords = ({ issuer }: OpenIdConnectSettings) =>
  `People sign in with their Auto accounts, through the identity provider at ${issuer}, since OIDC_ISSUER names none. This server registers itself there at its first sign-in, not at each start`;

function studioNotice(publicUrl: string, studio: StudioSettings = defaultStudio): Effect.Effect<void> {
  const link = studioLinkOf(studio, { ownOrigin: publicUrl, openedFrom: 'terminal', installId: undefined });
  return Effect.logInfo(`People open Studio at ${link}`).pipe(Effect.annotateLogs({ studio_link: link }));
}

const defaultStudio: StudioSettings = { origin: defaultStudioOrigin, served: false };

export function logSignInAtStart(
  settings: OpenIdConnectSettings,
  provider: 'given' | 'by default',
  studio: StudioSettings | undefined,
): Effect.Effect<void> {
  const { issuer, publicUrl, redirectUri } = settings;
  const words = provider === 'given' ? companySignInWords(settings) : signInByDefaultWords(settings);
  return Effect.logInfo(words).pipe(
    Effect.annotateLogs({ public_url: publicUrl, oidc_issuer: issuer, redirect_uri: redirectUri }),
    Effect.andThen(requiredClaimNotice(settings)),
    Effect.andThen(studioNotice(publicUrl, studio)),
  );
}

export function logSignInRefused(issuer: string, code: string): Effect.Effect<void> {
  return Effect.logWarning(`A sign-in came back from the identity provider at ${issuer} with the error ${code}`).pipe(
    Effect.annotateLogs({ oidc_issuer: issuer, error: code }),
  );
}

function valueRequiredIn({ requiredValue }: RequiredClaim): string {
  return requiredValue === undefined ? 'recorded at the first sign-in' : 'OIDC_REQUIRED_CLAIM gives';
}

export function logSignInRefusedForTheClaim(issuer: string, required: RequiredClaim): Effect.Effect<void> {
  return Effect.logWarning(
    `A sign-in was refused: its ID Token does not carry the claim ${required.claim} with the value ${valueRequiredIn(required)}`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, oidc_required_claim: required.claim }));
}

export function logRequiredClaimSet(issuer: string, claim: string, person: string): Effect.Effect<void> {
  return Effect.logInfo(
    `This server is set up: from now on only a person whose ID Token carries the claim ${claim} with the value recorded at this first sign-in can sign in`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, oidc_required_claim: claim, person }));
}

export const logSetupReopened: Effect.Effect<void> = Effect.logInfo(
  'Setup starts over and everyone is signed out. The next person to sign in sets the value every later sign-in must carry',
);

export function logSignInFailed(issuer: string, failure: string): Effect.Effect<void> {
  return Effect.logWarning(
    `A sign-in through the identity provider at ${issuer} could not be completed: ${failure}`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, failure }));
}

export function logNameUnread(issuer: string, person: string, failure: string): Effect.Effect<void> {
  return Effect.logWarning(
    `The name of a person signing in could not be read from the UserInfo endpoint of the identity provider at ${issuer}: ${failure}`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, person, failure }));
}

export function logRefreshTokenNotRevoked(issuer: string, failure: string): Effect.Effect<void> {
  return Effect.logWarning(
    `The refresh token the identity provider at ${issuer} sent could not be revoked: ${failure}`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, failure }));
}

export function logSignInNotBegun(issuer: string, failure: string): Effect.Effect<void> {
  return Effect.logWarning(`A sign-in could not begin: ${failure}`).pipe(
    Effect.annotateLogs({ oidc_issuer: issuer, failure }),
  );
}

export function logFirstSignInAwaited(org: string): Effect.Effect<void> {
  return Effect.logInfo(
    'No one has signed in yet. The first person to sign in becomes the admin of this organization.',
  ).pipe(Effect.annotateLogs({ org }));
}

export function logFirstAdmin(org: string, person: string): Effect.Effect<void> {
  return Effect.logInfo('The first person to sign in is now the admin of this organization').pipe(
    Effect.annotateLogs({ org, person }),
  );
}

export function logClientRegistered(issuer: string, clientId: string, replacing?: string): Effect.Effect<void> {
  const inPlaceOf = replacing === undefined ? '' : `, in place of the client ${replacing}`;
  return Effect.logInfo(
    `This server registered itself with the identity provider at ${issuer} as the client ${clientId}${inPlaceOf}`,
  ).pipe(
    Effect.annotateLogs({
      oidc_issuer: issuer,
      oidc_client_id: clientId,
      ...(replacing === undefined ? {} : { oidc_replaced_client_id: replacing }),
    }),
  );
}

export function logClientRegisteredElsewhereFirst(
  issuer: string,
  clientId: string,
  unused: string,
): Effect.Effect<void> {
  return Effect.logInfo(
    `Another server of this database registered with the identity provider at ${issuer} at the same moment, so this one signs people in as its client ${clientId}. The client ${unused} this one registered stays unused there`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, oidc_client_id: clientId, oidc_unused_client_id: unused }));
}

export function logClientNotRegistered(issuer: string, failure: string): Effect.Effect<void> {
  return Effect.logWarning(
    `A sign-in could not go on, since this server could not register itself again with the identity provider at ${issuer}: ${failure}`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, failure }));
}

export interface ClientsReport {
  readonly registered: (clientId: string, replacing: string | undefined) => void;
  readonly registeredElsewhereFirst: (clientId: string, unused: string) => void;
  readonly notRegistered: (failure: string) => void;
}

interface TokensReport {
  readonly nameUnread: (person: string, failure: string) => void;
  readonly notRevoked: (failure: string) => void;
}

export interface AdmissionReport extends TokensReport {
  readonly addressNotForgotten: () => void;
}

function logInvitationAddressNotForgotten(org: string): Effect.Effect<void> {
  return Effect.logError(
    'The address of an invitation accepted at a sign-in could not be forgotten now; the next change of the members forgets it',
  ).pipe(Effect.annotateLogs({ org }));
}

export interface SignInReport extends ClientsReport, AdmissionReport {
  readonly refused: (code: string) => void;
  readonly refusedForTheClaim: (required: RequiredClaim) => void;
  readonly failed: (failure: string) => void;
  readonly notBegun: (failure: string) => void;
  readonly firstAdmin: (person: string) => void;
}

export function signInReportTo(logged: (log: Effect.Effect<void>) => void, issuer: string): SignInReport {
  return {
    refused: (code) => {
      logged(logSignInRefused(issuer, code));
    },
    refusedForTheClaim: (required) => {
      logged(logSignInRefusedForTheClaim(issuer, required));
    },
    failed: (failure) => {
      logged(logSignInFailed(issuer, failure));
    },
    notBegun: (failure) => {
      logged(logSignInNotBegun(issuer, failure));
    },
    firstAdmin: (person) => {
      logged(logFirstAdmin(defaultOrg, person));
    },
    nameUnread: (person, failure) => {
      logged(logNameUnread(issuer, person, failure));
    },
    notRevoked: (failure) => {
      logged(logRefreshTokenNotRevoked(issuer, failure));
    },
    addressNotForgotten: () => {
      logged(logInvitationAddressNotForgotten(defaultOrg));
    },
    registered: (clientId, replacing) => {
      logged(logClientRegistered(issuer, clientId, replacing));
    },
    registeredElsewhereFirst: (clientId, unused) => {
      logged(logClientRegisteredElsewhereFirst(issuer, clientId, unused));
    },
    notRegistered: (failure) => {
      logged(logClientNotRegistered(issuer, failure));
    },
  };
}
