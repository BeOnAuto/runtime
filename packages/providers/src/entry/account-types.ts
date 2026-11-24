import { alternatives } from '@on.auto/phrasing';
import { Schema } from 'effect';

import type { Permissions } from './gateway-ways.ts';

export const AccountTypeSchema = Schema.Literals(['service', 'personal']);

export type AccountType = typeof AccountTypeSchema.Type;

const everyAccountType: readonly AccountType[] = ['service', 'personal'];

const accountTypeTakenWhereNoneIsGiven: AccountType = 'personal';

export const AccountTypesSchema = Schema.Array(AccountTypeSchema).check(Schema.isMinLength(1)).annotate({
  description:
    'The kinds of account at the service that a connection made this way may act as, on a way with delegated permissions. service is an account the company made for automations. personal is the account of the person who connects. Both when it is left out.',
});

interface ActingWay {
  readonly kind: string;
  readonly permissions?: Permissions | undefined;
  readonly managed_service_account?: boolean | undefined;
  readonly service_account?: 'managed' | undefined;
}

interface WayOfAccounts extends ActingWay {
  readonly account_types?: readonly AccountType[] | undefined;
}

const kindsOfTheApp: ReadonlySet<string> = new Set(['client_credentials', 'jwt_bearer', 'token_exchange']);

export function permissionsOf({ kind, permissions }: ActingWay): Permissions | undefined {
  if (kind === 'none') {
    return undefined;
  }
  return kindsOfTheApp.has(kind) ? 'application' : (permissions ?? 'delegated');
}

export function accountTypesOf(way: WayOfAccounts): readonly AccountType[] {
  const declared = way.account_types ?? everyAccountType;
  return permissionsOf(way) === 'delegated' ? everyAccountType.filter((type) => declared.includes(type)) : [];
}

export function accountTypeWhereNoneIsGiven(taken: readonly AccountType[]): AccountType | undefined {
  return taken.includes(accountTypeTakenWhereNoneIsGiven) ? accountTypeTakenWhereNoneIsGiven : taken[0];
}

export function accountTypeIssueOf(given: AccountType, taken: readonly AccountType[]): string | undefined {
  return taken.includes(given) ? undefined : `Expected ${alternatives(taken)}, which this connection's way takes.`;
}

export function isAManagedServiceAccount({
  managed_service_account: managed,
  service_account: serviceAccount,
}: ActingWay): boolean {
  return managed === true || serviceAccount === 'managed';
}

export function isTheWayAsked(way: ActingWay, asked: ActingWay): boolean {
  return (
    way.kind === asked.kind &&
    permissionsOf(way) === permissionsOf(asked) &&
    isAManagedServiceAccount(way) === isAManagedServiceAccount(asked)
  );
}

const ofAnApplication =
  'Expected no account_types. A connection made through a way with application permissions acts as the app.';

function repeatedIssuesOf(given: readonly AccountType[]): readonly Schema.FilterIssue[] {
  return given.flatMap((type, index) =>
    given.indexOf(type) < index
      ? [{ path: ['account_types', index], issue: `Expected ${type} once in account_types` }]
      : [],
  );
}

export function accountTypeIssuesOf(way: WayOfAccounts): readonly Schema.FilterIssue[] {
  const given = way.account_types;
  if (given === undefined) {
    return [];
  }
  return way.permissions === 'application'
    ? [{ path: ['account_types'], issue: ofAnApplication }]
    : repeatedIssuesOf(given);
}
