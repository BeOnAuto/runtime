import {
  accountTypeWhereNoneIsGiven,
  accountTypesOf,
  isTheWayAsked,
  permissionsOf,
  providerFoundBy,
  type AccountType,
  type CredentialWay,
  type ProviderList,
} from '@on.auto/providers';

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

function additionAsItActs(providers: ProviderList, added: ConnectionAdded): ConnectionAdded {
  const { data } = added;
  if (data.credential.permissions !== undefined) {
    return added;
  }
  const way = onlyWayOfItsKind(data, providers) ?? data.credential;
  const permissions = permissionsOf(way);
  if (permissions === undefined) {
    return added;
  }
  const accountType = accountTypeWhereNoneIsGiven(accountTypesOf(way));
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
