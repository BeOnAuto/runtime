import { awaitsItsFirstAdmin, enrolledAtSignIn, roleAssignmentDecider, type Enrolled } from '@on.auto/access-control';
import { roleAssignmentsStreamOf } from '@on.auto/access-control/role-assignment-facts';
import type { AppRuntime } from '@on.auto/api';
import {
  defaultOrg,
  personSignedInOf,
  type PeopleRows,
  type SignedInPerson,
  type StandardClaims,
} from '@on.auto/openid-connect';
import { Ledger, OrgWriter, signedInPersonPrefix, streamPrefixOfOrg } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import { logFirstSignInAwaited } from '../logging/logging.ts';
import { inRuntime } from '../workflows/in-runtime.ts';

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

export interface Admitting {
  readonly enrolling: Enrolling;
  readonly people: PeopleRows;
}

export interface SignedInWith {
  readonly signedIn: SignedInPerson;
  readonly claims: StandardClaims;
}

export interface Admitted {
  readonly signedIn: SignedInPerson;
  readonly person: string;
  readonly enrolled: Enrolled;
}

export async function admittedAfter(
  { enrolling, people }: Admitting,
  { signedIn, claims }: SignedInWith,
  at: number,
): Promise<Admitted | { readonly failed: string }> {
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
