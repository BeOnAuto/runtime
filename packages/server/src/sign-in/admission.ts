import { awaitsItsFirstAdmin, enrolledAtSignIn, roleAssignmentDecider, type Enrolled } from '@on.auto/access-control';
import { roleAssignmentsStreamOf } from '@on.auto/access-control/role-assignment-facts';
import type { AppRuntime } from '@on.auto/api';
import {
  defaultOrg,
  personSignedInOf,
  type PeopleRows,
  type RequiredClaim,
  type SignedInPerson,
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

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { logFirstSignInAwaited } from '../logging/sign-in-logging.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import {
  signInClientRegistrationsOf,
  type RegistrationServices,
  type SignInClientRegistrations,
} from './client-registrations.ts';

type Enrolment = { readonly enrolled: Enrolled } | { readonly failed: string };

export interface Enrolling {
  readonly enrolled: (person: string) => Promise<Enrolment>;
  readonly firstAdminAwaited: () => Promise<boolean>;
}

const streamsOfTheOrg = streamPrefixOfOrg({ org: defaultOrg });

const rolesOfTheOrg = `${streamsOfTheOrg}${roleAssignmentsStreamOf({ type: 'org', id: defaultOrg })}`;

function writerOfTheOrg(ledger: Ledger['Service']) {
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

const firstAdminAwaitedNow = Effect.flatMap(Effect.service(Ledger), (ledger) =>
  Effect.map(ledger.load(rolesOfTheOrg, roleAssignmentDecider), ({ state }) => awaitsItsFirstAdmin(state)),
);

export function enrollingIn(runtime: AppRuntime<Ledger>): Enrolling {
  return {
    enrolled: (person) => Effect.runPromise(inRuntime(runtime, enrolledNow(person))),
    firstAdminAwaited: () => Effect.runPromise(inRuntime(runtime, firstAdminAwaitedNow)),
  };
}

export function clientRegistrationsIn(
  runtime: AppRuntime<DispatcherServices>,
): (secrets: RegistrationServices['secrets']) => SignInClientRegistrations {
  return (secrets) => signInClientRegistrationsOf({ registry: runtimeLedger(runtime), secrets });
}

export interface Admitting {
  readonly enrolling: Enrolling;
  readonly people: PeopleRows;
  readonly requiredClaim: RequiredClaim | undefined;
}

export interface SignedInWith {
  readonly signedIn: SignedInPerson;
  readonly claims: StandardClaims;
  readonly valueOfTheRequiredClaim?: string;
}

export interface Admitted {
  readonly signedIn: SignedInPerson;
  readonly person: string;
  readonly enrolled: Enrolled;
}

export interface RefusedForTheClaim {
  readonly refusedForTheClaim: string;
}

function requiredClaimNotCarried(
  requiredClaim: RequiredClaim | undefined,
  { valueOfTheRequiredClaim }: SignedInWith,
): string | undefined {
  return requiredClaim === undefined || valueOfTheRequiredClaim === requiredClaim.requiredValue
    ? undefined
    : requiredClaim.claim;
}

export async function admittedAfter(
  { enrolling, people, requiredClaim }: Admitting,
  signedInWith: SignedInWith,
  at: number,
): Promise<Admitted | RefusedForTheClaim | { readonly failed: string }> {
  const notCarried = requiredClaimNotCarried(requiredClaim, signedInWith);
  if (notCarried !== undefined) {
    return { refusedForTheClaim: notCarried };
  }
  const { signedIn, claims } = signedInWith;
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
