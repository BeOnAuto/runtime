import { sha256Of } from '@on.auto/content';

import type { SignedInPerson } from '../provider/relying-party.ts';
import type { StandardClaims } from '../provider/standard-claims.ts';
import type { PersonSignedIn } from './people-rows.ts';

export const defaultOrg = 'default';

export function personIdOf({ issuer, subject }: SignedInPerson): string {
  return sha256Of(JSON.stringify([issuer, subject]));
}

export function personSignedInOf(
  person: SignedInPerson,
  { name, email }: StandardClaims,
  updatedAt: number,
): PersonSignedIn {
  return {
    person: personIdOf(person),
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { emailAddress: email }),
    updatedAt,
  };
}
