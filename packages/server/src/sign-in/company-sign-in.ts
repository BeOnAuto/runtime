import {
  problemOf,
  problemResponse,
  sessionCookie,
  type ApiOptions,
  type CookieSessions,
  type RegisterRoutes,
  type RouteHandler,
} from '@on.auto/api';
import { signedInPersonOf, type Principal } from '@on.auto/identity';
import {
  defaultOrg,
  mostLifetimeMs,
  personIdOf,
  providerRequestsOverTheNetwork,
  relyingPartyOf,
  sessionsOf,
  type FinishedSignIn,
  type PeopleRows,
  type PendingSignIn,
  type ProviderRequests,
  type RelyingParty,
  type SessionRows,
  type Sessions,
  type SignedInPerson,
} from '@on.auto/openid-connect';
import { allPermissions } from '@on.auto/operations';
import type { Effect } from 'effect';
import { deleteCookie, generateCookie, getCookie, setCookie } from 'hono/cookie';

import { logFirstAdmin, logSignInFailed, logSignInRefused } from '../logging/logging.ts';
import { callbackPath, type OpenIdConnectSettings } from '../settings/openid-connect-settings.ts';
import { admittedAfter, firstSignInNoticed, type Admitted, type Admitting, type Enrolling } from './admission.ts';

export interface CompanySignIn {
  readonly relyingParty: RelyingParty;
  readonly publicUrl: string;
}

interface SigningIn extends CompanySignIn, Admitting {
  readonly sessions: Sessions;
}

export async function companySignInOf(
  settings: OpenIdConnectSettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): Promise<CompanySignIn> {
  return { relyingParty: await relyingPartyOf(settings, requests), publicUrl: settings.publicUrl };
}

const signInPath = '/auth/oidc';

const signOutPath = '/auth/sign-out';

const pendingSignInCookie = 'sign-in';

const pendingSignInSeconds = 600;

const hostOnly = { prefix: 'host', path: '/', secure: true, httpOnly: true } as const;

const pendingSignInAttributes = { ...hostOnly, sameSite: 'Lax' } as const;

const sessionAttributes = { ...hostOnly, sameSite: 'Strict' } as const;

const pendingValue = /^([\w-]+)\.([\w-]+)\.([\w-]+)$/u;

const notSignedIn = problemOf(
  'bad_request',
  'Couldn’t sign you in. Try again, or ask whoever runs Auto at your company.',
);

const noAccess = problemOf(
  'forbidden',
  'You don’t have access to this organization. Ask an admin of the organization to give you a role.',
);

const anotherOrigin = problemOf('origin_not_allowed', 'The origin of this request is not allowed');

interface SignInReport {
  readonly refused: (code: string) => void;
  readonly failed: (failure: string) => void;
  readonly firstAdmin: (person: string) => void;
}

type NotSignedIn = FinishedSignIn | { readonly failed: string } | undefined;

type ApiContext = Parameters<RouteHandler>[0];

function pendingIn(value: string | undefined): PendingSignIn | undefined {
  const match = pendingValue.exec(String(value));
  return match === null
    ? undefined
    : { state: String(match[1]), nonce: String(match[2]), codeVerifier: String(match[3]) };
}

const pendingSignInEnded = generateCookie(pendingSignInCookie, '', { ...pendingSignInAttributes, maxAge: 0 });

function seeOther(c: ApiContext, location: string, status: 302 | 303): Response {
  c.header('cache-control', 'no-store');
  return c.redirect(location, status);
}

function signInStarted({ relyingParty }: CompanySignIn): RouteHandler {
  return async (c) => {
    const { authorizationUrl, pending } = await relyingParty.signInStarted();
    const value = `${pending.state}.${pending.nonce}.${pending.codeVerifier}`;
    setCookie(c, pendingSignInCookie, value, { ...pendingSignInAttributes, maxAge: pendingSignInSeconds });
    return seeOther(c, authorizationUrl, 302);
  };
}

function reported(finished: NotSignedIn, report: SignInReport): void {
  if (finished !== undefined && 'refusedByTheProvider' in finished) {
    report.refused(finished.refusedByTheProvider);
  }
  if (finished !== undefined && 'failed' in finished) {
    report.failed(finished.failed);
  }
}

async function sessionEndedIn(c: ApiContext, { sessions }: SigningIn): Promise<void> {
  const identifier = getCookie(c, sessionCookie, 'host');
  if (identifier !== undefined) {
    await sessions.ended(identifier);
  }
}

function finishedIn(c: ApiContext, { relyingParty }: CompanySignIn): Promise<FinishedSignIn> | undefined {
  const pending = pendingIn(getCookie(c, pendingSignInCookie, 'host'));
  return pending === undefined ? undefined : relyingParty.signInFinished(new URL(c.req.url).search, pending);
}

function notSignedInAfter(finished: NotSignedIn, report: SignInReport): Response {
  reported(finished, report);
  return problemResponse(notSignedIn, { 'set-cookie': pendingSignInEnded });
}

async function refusedAccess(c: ApiContext, signIn: SigningIn): Promise<Response> {
  await sessionEndedIn(c, signIn);
  return problemResponse(noAccess, { 'set-cookie': pendingSignInEnded });
}

async function signedInAs(c: ApiContext, signIn: SigningIn, person: SignedInPerson): Promise<Response> {
  deleteCookie(c, pendingSignInCookie, pendingSignInAttributes);
  await sessionEndedIn(c, signIn);
  const identifier = await signIn.sessions.begun(person);
  setCookie(c, sessionCookie, identifier, { ...sessionAttributes, maxAge: mostLifetimeMs / 1000 });
  return seeOther(c, '/', 303);
}

interface Answering {
  readonly c: ApiContext;
  readonly signIn: SigningIn;
  readonly admitted: Admitted;
  readonly report: SignInReport;
}

const answeredAs: Readonly<Record<Admitted['enrolled'], (answering: Answering) => Promise<Response>>> = {
  bootstrap: ({ c, signIn, admitted, report }) => {
    report.firstAdmin(admitted.person);
    return signedInAs(c, signIn, admitted.signedIn);
  },
  enrolment: ({ c, signIn, admitted }) => signedInAs(c, signIn, admitted.signedIn),
  member: ({ c, signIn, admitted }) => signedInAs(c, signIn, admitted.signedIn),
  removed: ({ c, signIn }) => refusedAccess(c, signIn),
};

async function admittedIn(c: ApiContext, signIn: SigningIn): Promise<Admitted | NotSignedIn> {
  const finished = await finishedIn(c, signIn);
  return finished !== undefined && 'signedIn' in finished ? admittedAfter(signIn, finished, Date.now()) : finished;
}

function signInFinished(signIn: SigningIn, report: SignInReport): RouteHandler {
  return async (c) => {
    const admitted = await admittedIn(c, signIn);
    return admitted !== undefined && 'enrolled' in admitted
      ? answeredAs[admitted.enrolled]({ c, signIn, admitted, report })
      : notSignedInAfter(admitted, report);
  };
}

function signedOut(signIn: SigningIn): RouteHandler {
  const ownOrigin = new URL(signIn.publicUrl).origin;
  return async (c) => {
    if (c.req.header('origin') !== ownOrigin) {
      return problemResponse(anotherOrigin);
    }
    await sessionEndedIn(c, signIn);
    deleteCookie(c, sessionCookie, sessionAttributes);
    return seeOther(c, '/', 303);
  };
}

function companySignInRoutes(signIn: SigningIn, report: SignInReport): RegisterRoutes {
  return (routes) => {
    routes.addPublic('GET', signInPath, signInStarted(signIn));
    routes.addPublic('GET', callbackPath, signInFinished(signIn, report));
    routes.addPublic('POST', signOutPath, signedOut(signIn));
  };
}

function keptIn<Kept>(kept?: Kept): Kept {
  if (kept === undefined) {
    throw new Error(
      "A company sign-in keeps its sessions and its people in the sign-in's store, and decides a person's role at the ledger, which this server's composition does not open",
    );
  }
  return kept;
}

interface SignInServed {
  readonly sessionRows?: SessionRows;
  readonly peopleRows?: PeopleRows;
  readonly enrolling?: Enrolling;
}

function principalOfThe(person: SignedInPerson): Principal {
  const id = personIdOf(person);
  return signedInPersonOf({ subject: id, name: id, org: defaultOrg, permissions: allPermissions });
}

function cookieSessionsOf(sessions: Sessions): CookieSessions {
  return {
    principalOf: async (identifier) => {
      const person = await sessions.personOf(identifier);
      return person === undefined ? person : principalOfThe(person);
    },
  };
}

export function signedInApiOf(
  signIn: CompanySignIn | undefined,
): (sessionRows?: SessionRows) => Pick<ApiOptions, 'sessions' | 'publicUrl'> {
  if (signIn === undefined) {
    return () => ({});
  }
  return (sessionRows) => ({
    sessions: cookieSessionsOf(sessionsOf(keptIn(sessionRows))),
    publicUrl: signIn.publicUrl,
  });
}

function reportTo(logged: (log: Effect.Effect<void>) => void, issuer: string): SignInReport {
  return {
    refused: (code) => {
      logged(logSignInRefused(issuer, code));
    },
    failed: (failure) => {
      logged(logSignInFailed(issuer, failure));
    },
    firstAdmin: (person) => {
      logged(logFirstAdmin(defaultOrg, person));
    },
  };
}

export function signInRoutesOf(
  signIn: CompanySignIn | undefined,
): (logged: (log: Effect.Effect<void>) => void, served?: SignInServed) => readonly RegisterRoutes[] {
  if (signIn === undefined) {
    return () => [];
  }
  return (logged, { sessionRows, peopleRows, enrolling } = {}) => {
    const signingIn: SigningIn = {
      ...signIn,
      sessions: sessionsOf(keptIn(sessionRows)),
      people: keptIn(peopleRows),
      enrolling: keptIn(enrolling),
    };
    logged(firstSignInNoticed(signingIn.enrolling));
    return [companySignInRoutes(signingIn, reportTo(logged, signIn.relyingParty.issuer))];
  };
}
