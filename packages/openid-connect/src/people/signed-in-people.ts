import { sha256Of } from '@on.auto/content';

import type { SignedInPerson } from '../provider/relying-party.ts';

export const defaultOrg = 'default';

export function personIdOf({ issuer, subject }: SignedInPerson): string {
  return sha256Of(JSON.stringify([issuer, subject]));
}
