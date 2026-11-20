import {
  awaitsItsFirstAdmin,
  enrolledAtSignIn,
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

import { logFirstSignInAwaited, type TokensReport } from '../logging/sign-in-logging.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { clientRegistrationsIn } from './client-registrations.ts';
import { setupIn, type RequiredClaimSet, type Setup } from './setup.ts';

type Enrolment = { readonly enrolled: Enrolled } | { readonly failed: string };

export interface Enrolling {
  readonly enrolled: (person: string) => Promise<Enrolment>;
  readonly holdsARole: (person: string) => Promise<boolean>;
  readonly firstAdminAwaited: () => Promise<boolean>;
}

const streamsOfTheOrg = streamPrefixOfOrg({ org: defaultOrg });

const rolesOfTheOrg = `${streamsOfTheOrg}${roleAssignmentsStreamOf({ type: 'org', id: defaultOrg })}`;

export function writerOfTheOrg(ledger: Ledger['Service']) {
  return OrgWriter.of({
    execute: (stream, decider, command, lineage) =>
      ledger.execute(`${streamsOfTheOrg}${stream}`, decider, command, lineage),
  });
}

const enrolledNow = Effect.fnUntraced(function* (person: string) {
  const ledger = yield* Effect.service(Ledger);
  const at = DateTime.formatIso(yield* DateTime.now);
  const enrolling = enrolledAtSignIn(defaultOrg, person, { at, by: `${signedInPersonPrefix}${person}` });
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

export function enrollingIn(runtime: AppRuntime<Ledger>): Enrolling {
  return {
    enrolled: (person) => Effect.runPromise(inRuntime(runtime, enrolledNow(person))),
    holdsARole: (person) => Effect.runPromise(inRuntime(runtime, holdsARoleNow(person))),
    firstAdminAwaited: () => Effect.runPromise(inRuntime(runtime, firstAdminAwaitedNow)),
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
  readonly requiredClaim: RequiredClaim | undefined;
  readonly report: TokensReport;
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
  report: TokensReport,
  { signedIn, claims, held }: SignedInWith,
  nameAsked: boolean,
): Promise<StandardClaims> {
  if (held === undefined) {
    return claims;
  }
  const { name, nameUnread, notRevoked } = await held.released(nameAsked);
  if (nameUnread !== undefined) {
    report.nameUnread(personIdOf(signedIn), nameUnread);
  }
  if (notRevoked !== undefined) {
    report.notRevoked(notRevoked);
  }
  return name === undefined ? claims : { ...claims, name };
}

export async function admittedAfter(
  { enrolling, setup, people, requiredClaim, report }: Admitting,
  signedInWith: SignedInWith,
  at: number,
): Promise<Admitted | NotAdmitted> {
  const notCarried = await requiredClaimNotCarried({ requiredClaim, setup }, signedInWith);
  const claims = await claimsOnceReleased(report, signedInWith, notCarried === undefined);
  if (notCarried !== undefined) {
    return notCarried;
  }
  const { signedIn } = signedInWith;
  const kept = personSignedInOf(signedIn, claims, at);
  const enrolment = await enrolling.enrolled(kept.person);
  if ('failed' in enrolment) {
    return enrolment;
  }
  await people.kept(kept);
  return { signedIn, person: kept.person, enrolled: enrolment.enrolled };
}

export function firstSignInNoticed(enrolling: Enrolling): Effect.Effect<void> {
  return Effect.promise(() => enrolling.firstAdminAwaited()).pipe(
    Effect.flatMap((awaited) => (awaited ? logFirstSignInAwaited(defaultOrg) : Effect.void)),
    Effect.ignoreCause,
  );
}
