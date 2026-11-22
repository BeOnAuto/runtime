import { Conflict, type LinkToOpen, type OfferedLink } from '@on.auto/operations';
import { capitalized, counted, listed, quoted, type Noun } from '@on.auto/phrasing';
import { providerNamed, type ProviderList, type ScopeGroup } from '@on.auto/providers';
import { Option, Result } from 'effect';

import { linkLastsMs } from '../links/link-token.ts';
import { groupNamed } from '../providers/asking-more.ts';
import type { Connection } from '../registry/connection.ts';
import type { AddedConnection, AdditionSchema } from './connection-fields.ts';
import type { SecretKeeping } from './connection-services.ts';
import { standingAfterTheLink } from './registry-access.ts';

const connectionNoun: Noun = { one: 'connection', other: 'connections' };

const mostNamed = 20;

export function removalAttempted(id: string): string {
  return `remove the connection ${quoted(id)}`;
}

export function connectionNamed({ name }: Pick<Connection, 'name'>): string {
  return `the connection ${quoted(name)}`;
}

export function additionAttempted({ name, provider }: Pick<typeof AdditionSchema.Type, 'name' | 'provider'>): string {
  return name === undefined ? `connect the provider ${quoted(String(provider))}` : `add ${connectionNamed({ name })}`;
}

export function reconnectionAttempted({ id }: { readonly id: string }): string {
  return `reconnect the connection ${quoted(id)}`;
}

export function moreHeldAlready(name: string, more: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} holds every scope of ${quoted(more)} already, so a link for it would ask nothing more`,
  });
}

export function moreUncovered(name: string, more: string, scope: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} cannot be granted ${quoted(more)}, since no client set up here covers every scope its consent would ask, ${scope}`,
  });
}

function shortly({ name, status }: Connection): string {
  return `${quoted(name)}, ${status}`;
}

export function connectionsListed(connections: readonly Connection[]): string {
  if (connections.length === 0) {
    return 'The org has no connection; search lists the tool servers its playbooks may already use.';
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

const givingTheCredential = 'give its credential where it takes one';

const givingTheOrgsOAuthClient =
  "give the client ID and the client secret of the organization's own OAuth client, registered with the provider, then sign in";

function doingOf({ provider, credential }: Linked): string {
  if (credential.client_source === 'own') {
    return givingTheOrgsOAuthClient;
  }
  if (provider !== null || credential.kind !== 'authorization') {
    return givingTheCredential;
  }
  const { host } = new URL(Option.getOrThrow(Option.fromNullishOr(credential.issuer)));
  return `sign in at ${host}`;
}

function linkWordsOf(connection: Linked, providers: ProviderList): string {
  const linkName = approvalLinkNamed(providerTitleOf(connection.provider, providers));
  return `Show the person who added the connection a link named ${linkName}, never its address. On that page they approve it and ${doingOf(connection)}, within 24 hours.`;
}

function groupWordsOf(group: ScopeGroup | undefined): readonly string[] {
  return group === undefined ? [] : [`The link asks them to allow ${quoted(group.name)} as well: ${group.for}`];
}

function connectedWordsOf(named: string, linkRanOut: boolean): string {
  return linkRanOut
    ? `The link for ${named} expired unused. The connection is still connected.`
    : `Connected ${named}; nothing is left to open.`;
}

function standingWordsOf(connection: Omit<AddedConnection, 'connect'>): string {
  const named = connectionNamed(connection);
  if (connection.link_replaced === true) {
    return `${capitalized(named)} is ${connection.status}. A newer link is available. The person who added the connection should open that link; reconnecting would replace it again.`;
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
  after: readonly string[],
): string {
  return connect === undefined
    ? standingWordsOf(connection)
    : [done(connectionNamed(connection)), linkWordsOf(connection, providers), ...after].join(' ');
}

function groupAskedOf(
  connection: AddedConnection,
  providers: ProviderList,
  more: string | undefined,
): ScopeGroup | undefined {
  return more === undefined ? undefined : groupNamed(connection, providers, more);
}

function requestedWordsOf({ name }: Pick<Connection, 'name'>): string {
  return `The person may not approve connections in this organization, so a request to connect ${quoted(name)} was sent to its admins, and there is no link to show. Tell the person that an admin has to approve it. list_connections shows when it is connected.`;
}

export function addedWordsOf(added: AddedConnection, providers: ProviderList, more: string | undefined): string {
  if (added.request !== null) {
    return requestedWordsOf(added);
  }
  return linkedWordsOf(
    (named) => `Added ${named}.`,
    added,
    providers,
    groupWordsOf(groupAskedOf(added, providers, more)),
  );
}

function newLinkWordsOf(named: string, { status }: AddedConnection): string {
  return status === 'connected'
    ? `Gave a new link to ${named}, which stays connected as it is until the person finishes on the page and so replaces its credential; the link before it stops working.`
    : `Gave a new link to ${named}; the link before it stops working.`;
}

export function reconnectedWordsOf(
  reconnected: AddedConnection,
  providers: ProviderList,
  more: string | undefined,
): string {
  return linkedWordsOf(
    (named) => newLinkWordsOf(named, reconnected),
    reconnected,
    providers,
    groupWordsOf(groupAskedOf(reconnected, providers, more)),
  );
}

export function addedAgainWordsOf(added: AddedConnection, providers: ProviderList, more: string | undefined): string {
  const provider = Option.getOrThrow(Option.fromNullishOr(added.provider));
  return linkedWordsOf(
    (named) =>
      `Added ${named} again from the provider ${quoted(provider)}, under its name and for the same playbooks; the connection before is removed and its credential forgotten.`,
    added,
    providers,
    groupWordsOf(groupAskedOf(added, providers, more)),
  );
}

function linkToOpenOf({ connect, ...connection }: AddedConnection): LinkToOpen | undefined {
  return connect === undefined
    ? undefined
    : {
        message: `Open this page to approve ${connectionNamed(connection)}, and ${doingOf(connection)}, within 24 hours.`,
        url: connect.url,
      };
}

export function linkOffering(offering: {
  readonly secrets: Pick<SecretKeeping, 'endingsOf'>;
  readonly providers: ProviderList;
}) {
  return {
    linkToOpen: linkToOpenOf,
    answerAfterTheLink: {
      idOf: ({ id }: AddedConnection) => id,
      read: (offered: OfferedLink) => standingAfterTheLink(offering, offered),
      linkLastsMs,
    },
  };
}
