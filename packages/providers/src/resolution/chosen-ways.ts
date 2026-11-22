import type { Issue } from '@on.auto/operations';
import { alternatives } from '@on.auto/phrasing';
import { Result } from 'effect';

import { accountTypesOf, permissionsOf, type AccountType } from '../entry/account-types.ts';
import type { CredentialWay } from '../entry/credential-ways.ts';
import type { Permissions } from '../entry/gateway-ways.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';

export interface WayAsked {
  readonly kind?: string | undefined;
  readonly canBeGiven?: ((way: CredentialWay) => boolean) | undefined;
}

export interface Acting {
  readonly permissions?: Permissions;
  readonly account_types: readonly AccountType[];
}

export function actingOf(way: CredentialWay): Acting {
  const permissions = permissionsOf(way);
  return { ...(permissions === undefined ? {} : { permissions }), account_types: accountTypesOf(way) };
}

function everyWay(): boolean {
  return true;
}

function kindsOf(credentials: readonly CredentialWay[]): string {
  return alternatives([...new Set(credentials.map((offered) => offered.kind))]);
}

function kindRefusalOf(name: string, kind: string, credentials: readonly CredentialWay[]): readonly Issue[] {
  return [
    {
      pointer: '/credential/kind',
      detail: `The provider ${name} takes no ${kind} credential; it takes ${kindsOf(credentials)}`,
    },
  ];
}

function isAsked(offered: CredentialWay, { kind }: WayAsked): boolean {
  return kind === undefined || offered.kind === kind;
}

export function chosenWayOf(entry: ProviderEntry, asked: WayAsked): Result.Result<CredentialWay, readonly Issue[]> {
  const { canBeGiven = everyWay } = asked;
  const named = entry.credentials.filter((offered) => isAsked(offered, asked));
  const [first] = named;
  const way = named.find((offered) => canBeGiven(offered)) ?? first;
  return way === undefined
    ? Result.fail(kindRefusalOf(entry.name, String(asked.kind), entry.credentials))
    : Result.succeed(way);
}
