import type { DeclaredFact } from '@on.auto/definitions';
import type { FactSchemaRead } from '@on.auto/ledger';
import { contentHoldersOf, type ContentHolders } from '@on.auto/operations';

import { factSchemasKnownWith } from './known-facts.ts';

interface KnownFacts {
  readonly factSchemas: readonly FactSchemaRead[];
  readonly holders: ContentHolders;
}

export function factsKnownWith(declared: readonly DeclaredFact[]): KnownFacts {
  const factSchemas = factSchemasKnownWith(declared);
  return { factSchemas, holders: contentHoldersOf(factSchemas) };
}
