import { asNamedIn, type ProviderList } from '@on.auto/providers';

import type { ConnectionAdded, RecordedConnectionEvent } from './connection-events.ts';
import { factsAsTheyAct } from './what-connections-act-as.ts';

interface Named {
  readonly provider: string | null;
  readonly entry: ConnectionAdded['data']['entry'];
}

export function namedNowIn<Connection extends Named>(providers: ProviderList, connection: Connection): Connection {
  const { provider, entry } = connection;
  if (provider === null) {
    return connection;
  }
  const named = asNamedIn(providers, { provider, document: entry.document });
  if (named.provider === provider) {
    return connection;
  }
  const document = named.document === undefined ? {} : { document: named.document };
  return { ...connection, provider: named.provider, entry: { ...entry, ...document } };
}

function additionAsNamedIn(providers: ProviderList, added: ConnectionAdded): ConnectionAdded {
  const data = namedNowIn(providers, added.data);
  return data === added.data ? added : { ...added, data };
}

function factsAsNamedIn(providers: ProviderList): (fact: RecordedConnectionEvent) => RecordedConnectionEvent {
  return (fact) => (fact.type === 'connection_added' ? additionAsNamedIn(providers, fact) : fact);
}

export function factsAsReadIn(providers: ProviderList): (fact: RecordedConnectionEvent) => RecordedConnectionEvent {
  const asNamed = factsAsNamedIn(providers);
  const asTheyAct = factsAsTheyAct(providers);
  return (fact) => asTheyAct(asNamed(fact));
}
