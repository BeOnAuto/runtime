import { memoryLedgerWith, type MemoryLedger } from '@on.auto/operations/testing';

import { definitionNamesOf, unbounded } from '../identity/definition-names.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';

export function readModelLedgerOf(types: readonly string[]): MemoryLedger {
  return memoryLedgerWith({
    projections: [definitionsReadModelOf(types)],
    definitionNames: definitionNamesOf(types, unbounded),
  });
}
