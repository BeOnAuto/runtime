import type { KeyedProjection } from '@on.auto/operations';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { assetsOnStoresSuite, definitionsPlacedApart } from '../store-testing/assets-on-stores.ts';

function inMemory(projections: readonly KeyedProjection[]) {
  return Promise.resolve(memoryLedgerWith({ projections, definitionNames: definitionsPlacedApart }).layer);
}

describe('the assets of playbooks in memory', () => {
  assetsOnStoresSuite(inMemory);
});
