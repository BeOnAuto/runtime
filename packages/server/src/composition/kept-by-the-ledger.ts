import { definitionTypeOrder, runOutcomeMapping, type DeclaredFact } from '@on.auto/definitions';
import { definitionNamesOf, unbounded } from '@on.auto/definitions/identity';

import { keptProjections, keptStreamProjections } from './kept-projections.ts';
import { factsKnownWith } from './known-holders.ts';
import { layoutSteps } from './layout-steps.ts';

export function keptByTheLedgerWith(
  declared: readonly DeclaredFact[],
  mostActiveOf: (type: string) => number = unbounded,
) {
  return {
    definitionNames: definitionNamesOf(definitionTypeOrder, mostActiveOf),
    runOutcomes: runOutcomeMapping,
    projections: keptProjections,
    streamProjections: keptStreamProjections,
    layoutSteps,
    ...factsKnownWith(declared),
  };
}
