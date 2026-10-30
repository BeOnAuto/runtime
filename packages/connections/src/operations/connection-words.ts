import {
  required,
  capitalized,
  counted,
  listed,
  quoted,
  type LinkToOpen,
  type Noun,
  type OfferedLink,
} from '@on.auto/operations';
import { providerNamed, type ProviderList } from '@on.auto/providers';
import { Result } from 'effect';

import { linkLastsMs } from '../links/link-token.ts';
import type { Connection } from '../registry/connection.ts';
import type { AddedConnection } from './connection-fields.ts';
import type { SecretKeeping } from './connection-services.ts';
import { standingAfterTheLink } from './registry-access.ts';

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

type Linked = Pick<Connection, 'provider' | 'credential'>;

interface Doing {
  readonly theyDo: string;
  readonly youDo: string;
}

const givingTheCredential: Doing = {
  theyDo: 'gives its credential where it takes one',
  youDo: 'give its credential where it takes one',
};

function doingOf({ provider, credential }: Linked): Doing {
  if (provider !== null || credential.kind !== 'authorization') {
    return givingTheCredential;
  }
  const { host } = new URL(required(credential.issuer));
  return { theyDo: `signs in at ${host}`, youDo: `sign in at ${host}` };
}

function linkWordsOf(connection: Linked, providers: ProviderList): string {
  const linkName = approvalLinkNamed(providerTitleOf(connection.provider, providers));
  return `The person who added it approves it, and ${doingOf(connection).theyDo}, on the page its link opens, within 24 hours; shown to them as a link named ${linkName}, never as its address.`;
}

function connectedWordsOf(named: string, linkRanOut: boolean): string {
  return linkRanOut
    ? `The link of ${named} ran out unused, so the connection stands as it was, connected.`
    : `Connected ${named}; nothing is left to open.`;
}

function standingWordsOf(connection: Omit<AddedConnection, 'connect'>): string {
  const named = connectionNamed(connection);
  if (connection.link_replaced === true) {
    return `${capitalized(named)} is ${connection.status}, and a newer link, still open, replaced the one offered: the person who added it opens the newest, and reconnecting it would replace that one too.`;
  }
  if (connection.status === 'connected') {
    return connectedWordsOf(named, connection.link_ran_out === true);
  }
  if (connection.status === 'removed') {
    return `The person cancelled ${named} on the page, so it is removed and nothing is connected.`;
  }
  return `${capitalized(named)} is ${connection.status}, and its link is used up or expired, so nothing is left to open: reconnect it for a new link.`;
}

function linkedWordsOf(
  done: (named: string) => string,
  { connect, ...connection }: AddedConnection,
  providers: ProviderList,
): string {
  return connect === undefined
    ? standingWordsOf(connection)
    : `${done(connectionNamed(connection))} ${linkWordsOf(connection, providers)}`;
}

export function addedWordsOf(added: AddedConnection, providers: ProviderList): string {
  return linkedWordsOf((named) => `Added ${named}.`, added, providers);
}

function newLinkWordsOf(named: string, { status }: AddedConnection): string {
  return status === 'connected'
    ? `Gave a new link to ${named}, which stays connected as it is until the person finishes on the page and so replaces its credential; the link before it stops working.`
    : `Gave a new link to ${named}; the link before it stops working.`;
}

export function reconnectedWordsOf(reconnected: AddedConnection, providers: ProviderList): string {
  return linkedWordsOf((named) => newLinkWordsOf(named, reconnected), reconnected, providers);
}

function linkToOpenOf({ connect, ...connection }: AddedConnection): LinkToOpen | undefined {
  return connect === undefined
    ? undefined
    : {
        message: `Open this page to approve ${connectionNamed(connection)}, and ${doingOf(connection).youDo}, within 24 hours.`,
        url: connect.url,
      };
}

export function linkOffering(secrets: Pick<SecretKeeping, 'endingsOf'>) {
  return {
    linkToOpen: linkToOpenOf,
    answerAfterTheLink: {
      idOf: ({ id }: AddedConnection) => id,
      read: (offered: OfferedLink) => standingAfterTheLink(secrets, offered),
      linkLastsMs,
    },
  };
}
