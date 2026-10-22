import { counted, listed, quoted, type Noun } from '@on.auto/operations';
import { providerNamed, type ProviderList } from '@on.auto/providers';
import { Result } from 'effect';

import type { Connection } from '../registry/connection.ts';

const connectionNoun: Noun = { one: 'connection', other: 'connections' };

const mostNamed = 20;

export function connectionNamed({ name }: Pick<Connection, 'name'>): string {
  return `the connection ${quoted(name)}`;
}

function shortly({ name, status }: Connection): string {
  return `${quoted(name)}, ${status}`;
}

export function connectionsListed(connections: readonly Connection[]): string {
  if (connections.length === 0) {
    return 'The org has no connection.';
  }
  const named = connections.slice(0, mostNamed).map((connection) => shortly(connection));
  const others = connections.length - named.length;
  const verb = connections.length === 1 ? 'is' : 'are';
  return `There ${verb} ${counted(connections.length, connectionNoun)}: ${listed(others === 0 ? named : [...named, `${others} more`])}.`;
}

function providerTitleOf(provider: string | null, providers: ProviderList): string | undefined {
  return provider === null
    ? undefined
    : Result.getOrUndefined(Result.map(providerNamed(providers, provider), ({ entry }) => entry.title));
}

function approvalLinkNamed(providerTitle: string | undefined): string {
  return quoted(providerTitle === undefined ? 'Approve the connection' : `Approve the ${providerTitle} connection`);
}

export function linkWordsOf({ provider }: Pick<Connection, 'provider'>, providers: ProviderList): string {
  const linkName = approvalLinkNamed(providerTitleOf(provider, providers));
  return `The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes; shown to them as a link named ${linkName}, never as its address.`;
}
