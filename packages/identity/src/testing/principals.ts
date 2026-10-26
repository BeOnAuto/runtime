import type { CallerIdentity } from '@on.auto/operations';

import { isRefusal, localDeveloperOf, type Authentication, type Principal } from '../access/principal.ts';

export const localDeveloper: CallerIdentity = localDeveloperOf().own;

export function principalIn(authentication: Authentication): Principal | undefined {
  return isRefusal(authentication) ? undefined : authentication;
}
