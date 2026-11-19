import { commentChanges, commentOperations } from '@on.auto/activity';
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
import { defineGetEvent, defineListPlaybookChanges, defineListPlaybookEvents } from '@on.auto/playbooks';
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

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
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
  const presenters = [...makeDefinitionPresenters(capabilities, facts), ...goalPresenters(goals)];
  const { holders } = factsKnownWith(facts.onRuns);
  return [
    ...makeDefinitionOperations(capabilities, pages, { facts, presenters, holders, connections }, { goals, messages }),
    defineListPlaybookEvents(presenters, holders),
    defineListPlaybookChanges(presenters, [commentChanges, ...goalChangeNamings(goals)]),
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
