import { defaultOrg } from '@on.auto/openid-connect';
import { Effect } from 'effect';

export function logSignInRefused(issuer: string, code: string): Effect.Effect<void> {
  return Effect.logWarning(`A sign-in came back from the identity provider at ${issuer} with the error ${code}`).pipe(
    Effect.annotateLogs({ oidc_issuer: issuer, error: code }),
  );
}

export function logSignInRefusedForTheClaim(issuer: string, claim: string): Effect.Effect<void> {
  return Effect.logWarning(
    `A sign-in was refused: its ID Token does not carry the claim ${claim} with the value OIDC_REQUIRED_CLAIM gives`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, oidc_required_claim: claim }));
}

export function logSignInFailed(issuer: string, failure: string): Effect.Effect<void> {
  return Effect.logWarning(
    `A sign-in through the identity provider at ${issuer} could not be completed: ${failure}`,
  ).pipe(Effect.annotateLogs({ oidc_issuer: issuer, failure }));
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

export interface SignInReport extends ClientsReport {
  readonly refused: (code: string) => void;
  readonly refusedForTheClaim: (claim: string) => void;
  readonly failed: (failure: string) => void;
  readonly firstAdmin: (person: string) => void;
}

export function signInReportTo(logged: (log: Effect.Effect<void>) => void, issuer: string): SignInReport {
  return {
    refused: (code) => {
      logged(logSignInRefused(issuer, code));
    },
    refusedForTheClaim: (claim) => {
      logged(logSignInRefusedForTheClaim(issuer, claim));
    },
    failed: (failure) => {
      logged(logSignInFailed(issuer, failure));
    },
    firstAdmin: (person) => {
      logged(logFirstAdmin(defaultOrg, person));
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
