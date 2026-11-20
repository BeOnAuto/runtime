import {
  ClientRegistrationError,
  UnusableIdentityProviderError,
  type FinishedSignIn,
  type PeopleRows,
  type SignInAsked,
} from '@on.auto/openid-connect';
import type {
  InteractionSignIn,
  NotStarted,
  SignInOutcome,
  UpstreamSignInStarted,
} from '@on.auto/openid-connect/authorization-server';
import type { Effect } from 'effect';

import { signInReportTo, type SignInReport } from '../logging/sign-in-logging.ts';
import { admittedAfter, firstSignInNoticed, type Admitting, type Enrolling } from './admission.ts';
import { asItsClient, issuerOf, type AsItsClient, type ClientsServed, type CompanySignIn } from './company-client.ts';

export type Logged = (log: Effect.Effect<void>) => void;

export interface SignInStore {
  readonly peopleRows?: PeopleRows;
  readonly enrolling?: Enrolling;
  readonly setup?: Admitting['setup'];
  readonly signInClientRegistrations?: ReturnType<ClientsServed['registrations']>;
}

export interface SigningIn extends Admitting, AsItsClient {
  readonly report: SignInReport;
}

type SignedIn = Extract<FinishedSignIn, { readonly signedIn: unknown }>;

type NotSignedIn = Exclude<FinishedSignIn, SignedIn>;

const choosingAnAccount: SignInAsked = { prompt: 'select_account' };

const thePersonGaveUp = 'access_denied';

async function startedBy(
  { relyingParty, pending, report }: SigningIn,
  selectAccount: boolean,
): Promise<UpstreamSignInStarted | NotStarted> {
  try {
    const started = await relyingParty.signInStarted(selectAccount ? choosingAnAccount : {});
    return { location: started.authorizationUrl, pending: pending.valueOf(started.pending) };
  } catch (failure) {
    if (failure instanceof ClientRegistrationError) {
      report.notRegistered(failure.message);
      return { notStarted: true };
    }
    if (failure instanceof UnusableIdentityProviderError) {
      report.notBegun(failure.message);
      return { notStarted: true };
    }
    throw failure;
  }
}

function notAdmittedAfter(finished: NotSignedIn, report: SignInReport): SignInOutcome {
  if ('refusedByTheProvider' in finished) {
    report.refused(finished.refusedByTheProvider);
    return finished.refusedByTheProvider === thePersonGaveUp ? { gaveUp: true } : { refused: 'not_signed_in' };
  }
  report.failed(finished.failed);
  return { refused: 'not_signed_in' };
}

async function admittedBy(signIn: SigningIn, finished: SignedIn): Promise<SignInOutcome> {
  const admitted = await admittedAfter(signIn, finished, Date.now());
  if ('refusedForTheClaim' in admitted) {
    signIn.report.refusedForTheClaim(admitted.refusedForTheClaim);
    return { refused: 'not_that_account' };
  }
  if ('failed' in admitted) {
    signIn.report.failed(admitted.failed);
    return { refused: 'not_signed_in' };
  }
  if (admitted.enrolled === 'bootstrap') {
    signIn.report.firstAdmin(admitted.person);
  }
  return admitted.enrolled === 'removed' ? { refused: 'no_access' } : { admitted: admitted.person };
}

export function interactionSignInOf(signIn: SigningIn): InteractionSignIn {
  return {
    started: ({ selectAccount }) => startedBy(signIn, selectAccount),
    finished: async (query, value) => {
      const pending = signIn.pending.pendingIn(value);
      if (pending === undefined) {
        return { refused: 'not_signed_in' };
      }
      const finished = await signIn.relyingParty.signInFinished(query, pending);
      return 'signedIn' in finished ? admittedBy(signIn, finished) : notAdmittedAfter(finished, signIn.report);
    },
  };
}

export function keptIn<Kept>(kept?: Kept): Kept {
  if (kept === undefined) {
    throw new Error(
      "A company sign-in keeps its people, its authorization server's rows and its signing key in the sign-in's store, keeps that key sealed in the secret store, and decides a person's role at the ledger, which this server's composition does not open",
    );
  }
  return kept;
}

export async function signingInOf(signIn: CompanySignIn, logged: Logged, served: SignInStore): Promise<SigningIn> {
  const report = signInReportTo(logged, issuerOf(signIn));
  const { requiredClaim } = signIn;
  const enrolling = keptIn(served.enrolling);
  logged(firstSignInNoticed(enrolling));
  const registrations = () => keptIn(served.signInClientRegistrations);
  return {
    requiredClaim,
    people: keptIn(served.peopleRows),
    enrolling,
    setup: keptIn(served.setup),
    report,
    ...(await asItsClient(signIn, { registrations, report })),
  };
}
