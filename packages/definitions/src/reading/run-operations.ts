import type { ContentHolders, Presenter } from '@on.auto/operations';

import { defineGetPlaybookAnalytics } from '../analytics/get-playbook-analytics.ts';
import { defineCancelRun } from '../cancellation/cancel-run.ts';
import type { Capability } from '../capability/capability.ts';
import { makeDefinitionPresenters } from '../presenting/definition-presenters.ts';
import { composedFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import { defineGetRunHistory } from './get-run-history.ts';
import { defineListRuns } from './list-runs.ts';
import { storedTypesByStatus } from './run-status.ts';

export interface RunReading {
  readonly holders: ContentHolders;
  readonly facts?: CapabilityFacts;
  readonly presenters?: readonly Presenter[];
}

export function runOperations(capabilities: readonly Capability[], { holders, ...composed }: RunReading) {
  const { facts = composedFactsOf(capabilities) } = composed;
  const { presenters = makeDefinitionPresenters(capabilities, facts) } = composed;
  return [
    defineCancelRun(capabilities),
    defineListRuns(capabilities, storedTypesByStatus(facts.onRuns)),
    defineGetRunHistory(presenters, holders),
    defineGetPlaybookAnalytics(capabilities),
  ];
}
