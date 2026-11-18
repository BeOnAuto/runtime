import type { ContentStore } from '@on.auto/content';
import { definitionNamesWith } from '@on.auto/definitions/testing';
import { contentHoldersOf } from '@on.auto/operations';
import { memoryLedgerWith, type MemoryLedger } from '@on.auto/operations/testing';

import { AssetEventSchema, assets, assetTotals, generationsWaiting } from '../index.ts';

export function harnessLedger(store: ContentStore): MemoryLedger {
  return memoryLedgerWith({
    projections: [assets, assetTotals, generationsWaiting],
    holders: contentHoldersOf([AssetEventSchema]),
    store,
    definitionNames: definitionNamesWith([]),
  });
}
