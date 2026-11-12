import { credentialProblems } from '@on.auto/config';
import { alternatives } from '@on.auto/phrasing';
import { Schema } from 'effect';

import type { Events } from './event-destinations.ts';
import { pathOf, textsIn } from './json-texts.ts';

interface WithEvents {
  readonly events?: Events | undefined;
  readonly credentials: readonly { readonly kind: string; readonly more?: readonly { readonly name: string }[] }[];
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

function heldIssuesOf(events: Events): readonly EntryIssue[] {
  return textsIn(asJson(events), '/events')
    .filter(({ pointer, text }) => credentialProblems('', text, pointer).length > 0)
    .map(({ pointer }) => ({ path: pathOf(pointer), issue: heldCredential }));
}

export function eventIssuesOf(entry: WithEvents): readonly EntryIssue[] {
  const { events } = entry;
  return events === undefined ? [] : [...needsIssuesOf(entry, events), ...heldIssuesOf(events)];
}
