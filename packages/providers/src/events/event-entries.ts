import { credentialProblems } from '@on.auto/config';
import { alternatives } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { isADeclaredRequest } from './event-calls.ts';
import type { Events } from './event-destinations.ts';
import { pathOf, textsIn } from './json-texts.ts';

interface Way {
  readonly kind: string;
  readonly in?: string | undefined;
  readonly name?: string | undefined;
  readonly scheme?: string | undefined;
  readonly gateway?: object | undefined;
  readonly more?: readonly { readonly name: string }[] | undefined;
  readonly app_credentials?: readonly { readonly name: string }[] | undefined;
}

interface WithEvents {
  readonly events?: Events | undefined;
  readonly credentials: readonly Way[];
}

type EntryIssue = Schema.FilterIssue;

const asJson = Schema.decodeUnknownSync(Schema.Json);

const heldCredential =
  "Looks like a credential, which a provider's entry never holds: Auto makes the secret of a subscription, or keeps the one the service answers";

function groupsOf({ credentials }: WithEvents): readonly string[] {
  return credentials
    .filter(({ kind }) => kind === 'authorization')
    .flatMap(({ more = [] }) => more.map(({ name }) => name));
}

function needsIssueOf(needs: string, groups: readonly string[]): string | undefined {
  if (groups.length === 0) {
    return "Expected needs only where the entry's authorization way names in more the group of scopes subscribing takes";
  }
  return groups.includes(needs)
    ? undefined
    : `Expected a group of more of the entry's authorization way: ${alternatives(groups)}`;
}

function needsIssuesOf(entry: WithEvents, events: Events): readonly EntryIssue[] {
  const groups = groupsOf(entry);
  return events.destinations.flatMap(({ needs }, index): readonly EntryIssue[] => {
    const issue = needs === undefined ? undefined : needsIssueOf(needs, groups);
    return issue === undefined ? [] : [{ path: ['events', 'destinations', index, 'needs'], issue }];
  });
}

export function credentialsHeldIn(events: Events, root: string, issue: string): readonly EntryIssue[] {
  return textsIn(asJson(events), root)
    .filter(({ pointer, text }) => credentialProblems('', text, pointer).length > 0)
    .map(({ pointer }) => ({ path: pathOf(pointer), issue }));
}

function heldIssuesOf(events: Events): readonly EntryIssue[] {
  return credentialsHeldIn(events, '/events', heldCredential);
}

function isAKeySentAsABearerToken(way: Way): boolean {
  return way.in === 'header' && way.name?.toLowerCase() === 'authorization' && way.scheme?.toLowerCase() === 'bearer';
}

function givesABearerToken(way: Way): boolean {
  if (way.kind === 'secret') {
    return isAKeySentAsABearerToken(way);
  }
  return way.kind === 'client_credentials' || (way.kind === 'authorization' && way.gateway === undefined);
}

const callsOfASubscription = ['subscribe', 'renew', 'unsubscribe'] as const;

const noBearerWay =
  "Expected tool: a request carries the connection's credential as a bearer token, and no way of this entry gives one";

function bearerIssuesOf({ credentials }: WithEvents, events: Events): readonly EntryIssue[] {
  if (credentials.some((way) => givesABearerToken(way))) {
    return [];
  }
  return events.destinations.flatMap((destination, index) =>
    callsOfASubscription
      .filter((call) => isADeclaredRequest(destination[call]))
      .map((call) => ({ path: ['events', 'destinations', index, call], issue: noBearerWay })),
  );
}

function appCredentialsOf({ credentials }: WithEvents): readonly string[] {
  return credentials
    .filter(({ kind }) => kind === 'secret')
    .flatMap(({ app_credentials: named = [] }) => named.map(({ name }) => name));
}

function credentialIssueOf(credential: string, named: readonly string[]): string | undefined {
  if (named.length === 0) {
    return "Expected the name of an app credential of the entry's secret way, which a person gives beside the key, and the entry's secret way names none";
  }
  return named.includes(credential)
    ? undefined
    : `Expected an app credential of the entry's secret way: ${alternatives(named)}`;
}

function credentialIssuesOf(entry: WithEvents, events: Events): readonly EntryIssue[] {
  const named = appCredentialsOf(entry);
  return events.destinations.flatMap(({ credential }, index): readonly EntryIssue[] => {
    const issue = credential === undefined ? undefined : credentialIssueOf(credential, named);
    return issue === undefined ? [] : [{ path: ['events', 'destinations', index, 'credential'], issue }];
  });
}

export function eventIssuesOf(entry: WithEvents): readonly EntryIssue[] {
  const { events } = entry;
  return events === undefined
    ? []
    : [
        ...needsIssuesOf(entry, events),
        ...heldIssuesOf(events),
        ...bearerIssuesOf(entry, events),
        ...credentialIssuesOf(entry, events),
      ];
}
