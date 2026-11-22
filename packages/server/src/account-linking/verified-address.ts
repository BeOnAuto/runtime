import type { PeopleRows, PersonRow } from '@on.auto/openid-connect';

import { inLowerCase } from '../roles/members-read.ts';
import type { Enrolling } from '../sign-in/admission.ts';

type PersonOfAVerifiedAddress = (address: string) => Promise<string | undefined>;

function isVerifiedAs({ emailAddress, emailVerified }: PersonRow, sought: string): boolean {
  return emailVerified === true && emailAddress !== undefined && inLowerCase(emailAddress) === sought;
}

async function holdingARole(
  roles: Pick<Enrolling, 'holdsARole'>,
  verified: readonly PersonRow[],
): Promise<readonly string[]> {
  const holding = await Promise.all(
    verified.map(async ({ person }) => ((await roles.holdsARole(person)) ? [person] : [])),
  );
  return holding.flat();
}

export function personOfAVerifiedAddress(
  people: Pick<PeopleRows, 'listed'>,
  roles: Pick<Enrolling, 'holdsARole'>,
): PersonOfAVerifiedAddress {
  return async (address) => {
    const sought = inLowerCase(address);
    const verified = address === '' ? [] : (await people.listed()).filter((row) => isVerifiedAs(row, sought));
    const [only, ...others] = await holdingARole(roles, verified);
    return others.length === 0 ? only : undefined;
  };
}
