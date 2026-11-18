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

export interface SignInReport {
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
  };
}
