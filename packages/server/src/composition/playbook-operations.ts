import { commentChanges, commentOperations } from '@on.auto/activity';
import { connectionChanges, eventSubscriptionPresenter, type ConnectionsReporting } from '@on.auto/connections';
import {
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  inTheDirectoryListing,
  type Capability,
} from '@on.auto/definitions';
import type { SubjectPages } from '@on.auto/definitions/page';
import {
  goalChangeNamings,
  goalPresenters,
  goalsOperationsServed,
  type AskedAbout,
  type ServerConnected,
} from '@on.auto/goals';
import type { PlaybookAddress, RouteRegistration } from '@on.auto/operations';
import {
  defineGetEvent,
  defineListOrgChanges,
  defineListPlaybookChanges,
  defineListPlaybookEvents,
  defineGetRunTree,
  defineListEventLines,
  playbookChanges,
} from '@on.auto/playbooks';
import type { Effect } from 'effect';

import { directoryFactsOf, type ComposedFacts } from './composed-facts.ts';
import { factsKnownWith } from './known-holders.ts';

export interface ServedPages {
  readonly pages: SubjectPages;
}

export interface ServedGoals {
  readonly goals: boolean;
  readonly results: boolean;
  readonly messages: boolean;
  readonly connected?: ServerConnected | undefined;
  readonly askedAbout?: AskedAbout | undefined;
}

export interface ServedConnectionAccess {
  readonly connections: {
    readonly hasAccess: (playbook: PlaybookAddress, connection: string) => Effect.Effect<boolean>;
  };
}

export interface ServedConnectionEvents {
  readonly connectionEvents: ConnectionsReporting;
}

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

function presentersOf(capabilities: readonly Capability[], facts: ComposedFacts['facts'], goals: boolean) {
  return [...makeDefinitionPresenters(capabilities, facts), ...goalPresenters(goals), eventSubscriptionPresenter];
}

function playbookChangeNamings(goals: boolean) {
  return [commentChanges, ...goalChangeNamings(goals)];
}

export function orgChangesServing(
  capabilities: readonly Capability[],
  { facts, goals }: Pick<ComposedFacts, 'facts'> & Pick<ServedGoals, 'goals'>,
) {
  return defineListOrgChanges([playbookChanges, connectionChanges, commentChanges], {
    presenters: presentersOf(capabilities, facts, goals),
    namings: playbookChangeNamings(goals),
  });
}

export function playbookOperationsServing(
  capabilities: readonly Capability[],
  {
    facts,
    names,
    pages,
    goals,
    results,
    messages,
    connected,
    askedAbout,
    connections,
  }: Pick<ComposedFacts, 'facts' | 'names'> & ServedPages & ServedGoals & ServedConnectionAccess,
): readonly PlaybookOperation[] {
  const presenters = presentersOf(capabilities, facts, goals);
  const { holders } = factsKnownWith(facts.onRuns);
  return [
    ...makeDefinitionOperations(capabilities, pages, { facts, presenters, holders, connections }, { goals, messages }),
    defineListPlaybookEvents(presenters, holders),
    defineGetRunTree(presenters),
    defineListEventLines(presenters),
    defineListPlaybookChanges(presenters, playbookChangeNamings(goals)),
    defineGetEvent(presenters, holders),
    ...goalsOperationsServed(goals, results, messages, { connected, askedAbout }),
    definePublishEvent(names),
    ...commentOperations,
  ];
}

interface DeclaredAndServed extends ServedPages, ServedGoals, ServedConnectionAccess {
  readonly capabilities: readonly Capability[];
}

export function directoryOperationsServing(
  capabilities: readonly Capability[],
  { capabilities: declared, pages, goals, results, messages, connected, askedAbout, connections }: DeclaredAndServed,
): readonly PlaybookOperation[] {
  return playbookOperationsServing(inTheDirectoryListing(capabilities), {
    ...directoryFactsOf(declared),
    pages,
    goals,
    results,
    messages,
    connected,
    askedAbout,
    connections,
  });
}
