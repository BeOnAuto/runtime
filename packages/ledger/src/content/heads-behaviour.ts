import { memoryContentStore } from '@on.auto/content/testing';
import { interleavedRemovalBehaviour, unheldContentBehaviour } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { aLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';
import { erasedPutsBehaviour } from './erased-puts-behaviour.ts';
import { expiredHeadsBehaviour } from './expired-heads-behaviour.ts';
import { headsStepBehaviour } from './heads-step-behaviour.ts';
import { heldContentFoundBehaviour } from './held-content-found-behaviour.ts';
import { switchedStoresBehaviour } from './switched-stores-behaviour.ts';

export function headsBehaviour(entry: LedgerEntry): void {
  describe('the ledger whose content is kept in a store outside it', () => {
    unheldContentBehaviour({ aLedger: (holders) => aLedgerOutside(entry, holders, memoryContentStore()) });
    interleavedRemovalBehaviour({
      aStore: () => Promise.resolve(memoryContentStore()),
      aLedger: (holders, store) => aLedgerOutside(entry, holders, store),
    });
  });
  switchedStoresBehaviour(entry);
  headsStepBehaviour(entry);
  expiredHeadsBehaviour(entry);
  erasedPutsBehaviour(entry);
  heldContentFoundBehaviour(entry);
}
