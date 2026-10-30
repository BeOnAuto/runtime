import type { Presenter } from '@on.auto/operations';

import { defineGetPlaybookAnalytics } from '../analytics/get-playbook-analytics.ts';
import { defineCancelRun } from '../cancellation/cancel-run.ts';
import type { Capability } from '../capability/capability.ts';
import { defineGetRun } from '../operations/get-run.ts';
import { makeDefinitionPresenters } from '../presenting/definition-presenters.ts';
import { composedFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import { defineGetRunHistory } from './get-run-history.ts';
import { defineListRuns } from './list-runs.ts';
import { storedTypesByStatus } from './run-status.ts';

export function runOperations(
  capabilities: readonly Capability[],
  facts: CapabilityFacts = composedFactsOf(capabilities),
  presenters: readonly Presenter[] = makeDefinitionPresenters(capabilities, facts),
) {
  return [
    defineGetRun(capabilities),
    defineCancelRun(capabilities),
    defineListRuns(capabilities, storedTypesByStatus(facts.onRuns)),
    defineGetRunHistory(presenters),
    defineGetPlaybookAnalytics(capabilities),
  ];
}
