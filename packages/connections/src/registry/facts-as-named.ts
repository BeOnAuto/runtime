import { asNamedIn, type ProviderList } from '@on.auto/providers';

import type { ConnectionAdded, RecordedConnectionEvent } from './connection-events.ts';
import { factsAsTheyAct } from './what-connections-act-as.ts';

function additionAsNamedIn(providers: ProviderList, added: ConnectionAdded): ConnectionAdded {
  const { data } = added;
  const { provider, entry } = data;
  if (provider === null) {
    return added;
  }
  const named = asNamedIn(providers, { provider, document: entry.document });
  if (named.provider === provider) {
    return added;
  }
  const document = named.document === undefined ? {} : { document: named.document };
  return { ...added, data: { ...data, provider: named.provider, entry: { ...entry, ...document } } };
}

function factsAsNamedIn(providers: ProviderList): (fact: RecordedConnectionEvent) => RecordedConnectionEvent {
  return (fact) => (fact.type === 'connection_added' ? additionAsNamedIn(providers, fact) : fact);
}

export function factsAsReadIn(providers: ProviderList): (fact: RecordedConnectionEvent) => RecordedConnectionEvent {
  const asNamed = factsAsNamedIn(providers);
  const asTheyAct = factsAsTheyAct(providers);
  return (fact) => asTheyAct(asNamed(fact));
}
