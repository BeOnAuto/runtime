import {
  accountTypeWhereNoneIsGiven,
  accountTypesOf,
  isTheWayAsked,
  permissionsOf,
  providerFoundBy,
  type AccountType,
  type CredentialWay,
  type Permissions,
  type ProviderList,
} from '@on.auto/providers';

import type { RecordedCredential } from './acting-fields.ts';
import type { ConnectionAdded, RecordedConnectionEvent } from './connection-events.ts';
import type { Credential } from './credential.ts';

interface OfAWay {
  readonly provider: string | null;
  readonly credential: Credential;
}

export function wayOfTheConnection(
  { provider, credential }: OfAWay,
  providers: ProviderList,
): CredentialWay | undefined {
  return providerFoundBy(providers, provider)?.entry.credentials.find((way) => isTheWayAsked(way, credential));
}

export function accountTypesTakenBy(connection: OfAWay, providers: ProviderList): readonly AccountType[] {
  return accountTypesOf(wayOfTheConnection(connection, providers) ?? connection.credential);
}

function onlyWayOfItsKind({ provider, credential }: OfAWay, providers: ProviderList): CredentialWay | undefined {
  const ways = providerFoundBy(providers, provider)?.entry.credentials.filter(({ kind }) => kind === credential.kind);
  return ways?.length === 1 ? ways[0] : undefined;
}

export interface ActingAsAdded {
  readonly permissions: Permissions;
  readonly accountType: AccountType | undefined;
}

interface AsRecorded {
  readonly provider: string | null;
  readonly credential: RecordedCredential;
}

export function actingAsAddedOf(connection: AsRecorded, providers: ProviderList): ActingAsAdded | undefined {
  if (connection.credential.permissions !== undefined) {
    return undefined;
  }
  const way = onlyWayOfItsKind(connection, providers) ?? connection.credential;
  const permissions = permissionsOf(way);
  return permissions === undefined
    ? undefined
    : { permissions, accountType: accountTypeWhereNoneIsGiven(accountTypesOf(way)) };
}

function additionAsItActs(providers: ProviderList, added: ConnectionAdded): ConnectionAdded {
  const { data } = added;
  const acting = actingAsAddedOf(data, providers);
  if (acting === undefined) {
    return added;
  }
  const { permissions, accountType } = acting;
  return {
    ...added,
    data: {
      ...data,
      credential: { ...data.credential, permissions },
      ...(accountType === undefined ? {} : { account_type: accountType }),
    },
  };
}

export function factsAsTheyAct(providers: ProviderList): (fact: RecordedConnectionEvent) => RecordedConnectionEvent {
  return (fact) => (fact.type === 'connection_added' ? additionAsItActs(providers, fact) : fact);
}
