import { definitionTypeOrder, runIds, runOutcomeMapping, type DeclaredFact } from '@on.auto/definitions';
import { definitionNamesOf, unbounded } from '@on.auto/definitions/identity';

import { keptProjections } from './kept-projections.ts';
import { factsKnownWith } from './known-holders.ts';

export function keptByTheLedgerWith(
  declared: readonly DeclaredFact[],
  mostActiveOf: (type: string) => number = unbounded,
) {
  return {
    definitionNames: definitionNamesOf(definitionTypeOrder, mostActiveOf),
    runIds,
    runOutcomes: runOutcomeMapping,
    projections: keptProjections,
    ...factsKnownWith(declared),
  };
}
