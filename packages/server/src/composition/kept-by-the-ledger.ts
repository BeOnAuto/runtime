import { playbookChangeRowsLayoutSteps } from '@on.auto/activity';
import { connectionRowsLayoutSteps, subscriptionLayoutSteps } from '@on.auto/connections';
import { definitionTypeOrder, runIds, runOutcomeMapping, type DeclaredFact } from '@on.auto/definitions';
import { definitionAndGoalNamesOf, unbounded } from '@on.auto/definitions/identity';
import { playbookRowsLayoutSteps } from '@on.auto/playbooks';
import { hostLayoutSteps } from '@on.auto/workflow-host';

import { keptProjections } from './kept-projections.ts';
import { factsKnownWith } from './known-holders.ts';

export function keptByTheLedgerWith(
  declared: readonly DeclaredFact[],
  mostActiveOf: (type: string) => number = unbounded,
) {
  return {
    definitionNames: definitionAndGoalNamesOf(definitionTypeOrder, mostActiveOf),
    runIds,
    runOutcomes: runOutcomeMapping,
    projections: keptProjections,
    layoutSteps: [
      ...subscriptionLayoutSteps,
      ...hostLayoutSteps,
      ...playbookRowsLayoutSteps,
      ...playbookChangeRowsLayoutSteps,
      ...connectionRowsLayoutSteps,
    ],
    ...factsKnownWith(declared),
  };
}
