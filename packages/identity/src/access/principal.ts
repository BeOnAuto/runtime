import { userInfo } from 'node:os';

import { allPermissions, type CallerIdentity, type Permission } from '@on.auto/operations';
import { Result } from 'effect';

import type { ApiKey } from '../keys/api-key.ts';
import { localDeveloperId, localOrg } from './local-org.ts';

export interface Principal {
  readonly own: CallerIdentity;
  readonly callerIn: (org: string) => CallerIdentity | undefined;
}

export interface Refusal {
  readonly because: string | undefined;
}

export type Authentication = Principal | Refusal;

export interface VerifiedPerson {
  readonly subject: string;
  readonly name: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
}

export type LocalAccount = () => { readonly username: string };

export function isRefusal(authentication: Authentication): authentication is Refusal {
  return 'because' in authentication;
}

export const unexplained: Refusal = { because: undefined };

function nameOfThe(account: LocalAccount): string {
  const named = Result.try(() => account().username);
  return Result.isSuccess(named) && named.success !== '' ? named.success : localDeveloperId;
}

export function localDeveloperOf(account: LocalAccount = userInfo): Principal {
  const name = nameOfThe(account);
  const developerIn = (org: string): CallerIdentity => ({
    id: localDeveloperId,
    name,
    org,
    permissions: allPermissions,
    playbooks: '*',
  });
  return { own: developerIn(localOrg), callerIn: developerIn };
}

function principalOfCaller(caller: CallerIdentity): Principal {
  return { own: caller, callerIn: (asked) => (asked === caller.org ? caller : undefined) };
}

export function principalOf({ id, org, permissions, playbooks }: ApiKey): Principal {
  return principalOfCaller({ id, name: id, org, permissions, playbooks });
}

const personPrefix = 'person:';

export function signedInPersonOf({ subject, name, org, permissions }: VerifiedPerson): Principal {
  return principalOfCaller({ id: `${personPrefix}${subject}`, name, org, permissions, playbooks: '*' });
}

export function isSignedInPerson({ id }: Pick<CallerIdentity, 'id'>): boolean {
  return id.startsWith(personPrefix);
}

export function isKeyHolder({ id }: Pick<CallerIdentity, 'id'>): boolean {
  return id !== localDeveloperId && !id.includes(':');
}
