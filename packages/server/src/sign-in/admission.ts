import {
  awaitsItsFirstAdmin,
  enrolledAtSignIn,
  pendingInvitationOf,
  roleAssignmentDecider,
  rolesHeldBy,
  type Enrolled,
} from '@on.auto/access-control';
import { roleAssignmentsStreamOf } from '@on.auto/access-control/role-assignment-facts';
import type { AppRuntime } from '@on.auto/api';
import {
  defaultOrg,
  personIdOf,
  personSignedInOf,
  type InvitationAddresses,
  type PeopleRows,
  type RequiredClaim,
  type SignedInPerson,
  type SignedInWith,
  type StandardClaims,
} from '@on.auto/openid-connect';
import {
  Ledger,
  OrgWriter,
  signedInPersonPrefix,
  streamPrefixOfOrg,
  type DispatcherServices,
} from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import { logFirstSignInAwaited, type AdmissionReport } from '../logging/sign-in-logging.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { clientRegistrationsIn } from './client-registrations.ts';
import { setupIn, type RequiredClaimSet, type Setup } from './setup.ts';

type Enrolment = { readonly enrolled: Enrolled } | { readonly failed: string };

export interface Enrolling {
  readonly enrolled: (person: string, invitation?: string) => Promise<Enrolment>;
  readonly holdsARole: (person: string) => Promise<boolean>;
  readonly firstAdminAwaited: () => Promise<boolean>;
  readonly invitationPending: (invitation: string) => Promise<boolean>;
}

const streamsOfTheOrg = streamPrefixOfOrg({ org: defaultOrg });

const rolesOfTheOrg = `${streamsOfTheOrg}${roleAssignmentsStreamOf({ type: 'org', id: defaultOrg })}`;

export function writerOfTheOrg(ledger: Ledger['Service']) {
  return OrgWriter.of({
    execute: (stream, decider, command, lineage) =>
      ledger.execute(`${streamsOfTheOrg}${stream}`, decider, command, lineage),
  });
}

const enrolledNow = Effect.fnUntraced(function* (person: string, invitation: string | undefined) {
  const ledger = yield* Effect.service(Ledger);
  const at = DateTime.formatIso(yield* DateTime.now);
  const enrolling = enrolledAtSignIn(defaultOrg, person, { at, by: `${signedInPersonPrefix}${person}`, invitation });
  return yield* enrolling.pipe(
    Effect.provideService(OrgWriter, writerOfTheOrg(ledger)),
    Effect.map((enrolled): Enrolment => ({ enrolled })),
    Effect.catchTag('conflict', ({ detail }: { readonly detail: string }) =>
      Effect.succeed<Enrolment>({ failed: detail }),
    ),
  );
});

const rolesNow = Effect.flatMap(Effect.service(Ledger), (ledger) => ledger.load(rolesOfTheOrg, roleAssignmentDecider));

const firstAdminAwaitedNow = Effect.map(rolesNow, ({ state }) => awaitsItsFirstAdmin(state));

function holdsARoleNow(person: string) {
  return Effect.map(rolesNow, ({ state }) => rolesHeldBy(state, { type: 'person', id: person }).length > 0);
}

function invitationPendingNow(invitation: string) {
  return Effect.gen(function* () {
    const { state } = yield* rolesNow;
    return pendingInvitationOf(state, invitation, DateTime.formatIso(yield* DateTime.now)) !== undefined;
  });
}

export function enrollingIn(runtime: AppRuntime<Ledger>): Enrolling {
  return {
    enrolled: (person, invitation) => Effect.runPromise(inRuntime(runtime, enrolledNow(person, invitation))),
    holdsARole: (person) => Effect.runPromise(inRuntime(runtime, holdsARoleNow(person))),
    firstAdminAwaited: () => Effect.runPromise(inRuntime(runtime, firstAdminAwaitedNow)),
    invitationPending: (invitation) => Effect.runPromise(inRuntime(runtime, invitationPendingNow(invitation))),
  };
}

export interface AdmissionOpened {
  readonly enrolling: Enrolling;
  readonly setup: Setup;
  readonly clientRegistrationsWith: ReturnType<typeof clientRegistrationsIn>;
}

export function admissionIn(runtime: AppRuntime<DispatcherServices>): AdmissionOpened {
  return {
    enrolling: enrollingIn(runtime),
    setup: setupIn(runtime),
    clientRegistrationsWith: clientRegistrationsIn(runtime),
  };
}

export interface Admitting {
  readonly enrolling: Enrolling;
  readonly setup: Setup;
  readonly people: PeopleRows;
  readonly invitations: Pick<InvitationAddresses, 'forgotten'>;
  readonly requiredClaim: RequiredClaim | undefined;
  readonly report: AdmissionReport;
}

export interface Admitted {
  readonly signedIn: SignedInPerson;
  readonly person: string;
  readonly enrolled: Enrolled;
}

interface RefusedForTheClaim {
  readonly refusedForTheClaim: RequiredClaim;
}

type NotAdmitted = RefusedForTheClaim | { readonly failed: string };

function carries(inForce: RequiredClaimSet, asked: RequiredClaimSet): boolean {
  return inForce.issuer === asked.issuer && inForce.claim === asked.claim && inForce.value === asked.value;
}

async function requiredClaimNotCarried(
  { requiredClaim, setup }: Pick<Admitting, 'requiredClaim' | 'setup'>,
  { signedIn, valueOfTheRequiredClaim: value }: SignedInWith,
): Promise<NotAdmitted | undefined> {
  if (requiredClaim === undefined) {
    return undefined;
  }
  const refused = { refusedForTheClaim: requiredClaim };
  const { claim, requiredValue } = requiredClaim;
  if (value === undefined) {
    return refused;
  }
  if (requiredValue !== undefined) {
    return value === requiredValue ? undefined : refused;
  }
  const asked = { issuer: signedIn.issuer, claim, value, person: personIdOf(signedIn) };
  const inForce = await setup.requiredClaimSet(asked);
  if ('failed' in inForce) {
    return inForce;
  }
  return carries(inForce, asked) ? undefined : refused;
}

async function claimsOnceReleased(
  report: AdmissionReport,
  { signedIn, claims, held }: SignedInWith,
  asked: boolean,
): Promise<StandardClaims> {
  if (held === undefined) {
    return claims;
  }
  const { userInfoUnread, notRevoked, ...released } = await held.released(asked);
  if (userInfoUnread !== undefined) {
    report.userInfoUnread(personIdOf(signedIn), userInfoUnread);
  }
  if (notRevoked !== undefined) {
    report.notRevoked(notRevoked);
  }
  return { ...claims, ...released };
}

async function acceptedForgotten(
  { invitations, report }: Pick<Admitting, 'invitations' | 'report'>,
  carried: readonly string[],
): Promise<void> {
  try {
    await invitations.forgotten(carried);
  } catch {
    report.addressNotForgotten();
  }
}

export async function admittedAfter(
  { enrolling, setup, people, invitations, requiredClaim, report }: Admitting,
  signedInWith: SignedInWith,
  at: number,
  invitation?: string,
): Promise<Admitted | NotAdmitted> {
  const notCarried = await requiredClaimNotCarried({ requiredClaim, setup }, signedInWith);
  const claims = await claimsOnceReleased(report, signedInWith, notCarried === undefined);
  if (notCarried !== undefined) {
    return notCarried;
  }
  const { signedIn } = signedInWith;
  const kept = personSignedInOf(signedIn, claims, at);
  const carried = invitation === undefined ? [] : [invitation];
  const enrolment = await enrolling.enrolled(kept.person, invitation);
  if ('failed' in enrolment) {
    return enrolment;
  }
  await people.kept(kept);
  if (enrolment.enrolled === 'invitation') {
    await acceptedForgotten({ invitations, report }, carried);
  }
  return { signedIn, person: kept.person, enrolled: enrolment.enrolled };
}

export function firstSignInNoticed(enrolling: Enrolling): Effect.Effect<void> {
  return Effect.promise(() => enrolling.firstAdminAwaited()).pipe(
    Effect.flatMap((awaited) => (awaited ? logFirstSignInAwaited(defaultOrg) : Effect.void)),
    Effect.ignoreCause,
  );
}
