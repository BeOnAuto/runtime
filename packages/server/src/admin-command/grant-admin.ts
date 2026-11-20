import { adminRecovered } from '@on.auto/access-control';
import { defaultOrg, type PersonRow } from '@on.auto/openid-connect';
import { Ledger, OrgWriter } from '@on.auto/operations';
import { DateTime, Effect, Result } from 'effect';

import { writerOfTheOrg } from '../sign-in/admission.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import {
  alreadyAnAdmin,
  emailAddressAsked,
  ledgerChanged,
  ledgerRead,
  madeAnAdmin,
  noOneSignedInAs,
  out,
  refused,
  severalSignedInAs,
  type PersonNamed,
  type Said,
} from './admin-words.ts';
import { byACommand, type Opened, type OpeningOf } from './opened-for-a-command.ts';

interface Granting extends Pick<Opened, 'settings' | 'runtime'> {
  readonly signIn: Pick<Opened['signIn'], 'peopleRows'>;
}

interface SignedIn extends PersonNamed {
  readonly person: string;
}

function signedInAs(people: readonly PersonRow[], asked: string): readonly SignedIn[] {
  const sought = asked.toLowerCase();
  return people.flatMap(({ person, name, emailAddress }) =>
    emailAddress?.toLowerCase() === sought ? [{ person, name, emailAddress }] : [],
  );
}

function recovering(person: string) {
  return Effect.gen(function* () {
    const ledger = yield* Effect.service(Ledger);
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* adminRecovered(defaultOrg, person, { at, by: byACommand }).pipe(
      Effect.provideService(OrgWriter, writerOfTheOrg(ledger)),
    );
  });
}

async function grantedIn(asked: string, { settings, runtime, signIn }: Granting): Promise<Said> {
  const [found, ...others] = signedInAs(await signIn.peopleRows.listed(), asked);
  if (found === undefined) {
    return refused(noOneSignedInAs(asked), ledgerRead(settings.ledger));
  }
  if (others.length > 0) {
    return refused(severalSignedInAs(asked));
  }
  const recovered = await Effect.runPromise(Effect.result(inRuntime(runtime, recovering(found.person))));
  if (Result.isFailure(recovered)) {
    return refused(ledgerChanged);
  }
  return out(recovered.success === 'given' ? madeAnAdmin(found) : alreadyAnAdmin(found));
}

export function adminGrantedBy(given: readonly string[], open: OpeningOf<Granting>): Promise<Said> {
  const [asked] = given;
  return asked === undefined ? Promise.resolve(refused(emailAddressAsked)) : open((opened) => grantedIn(asked, opened));
}
