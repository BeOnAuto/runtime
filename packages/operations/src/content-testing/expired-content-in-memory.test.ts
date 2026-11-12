import {
  expiringContentBehaviour,
  interleavedErasureBehaviour,
  memoryContentStore,
  resultOf,
} from '@on.auto/content/testing';
import { describe } from 'vitest';

import { memoryLedger } from '../testing/memory-ledger.ts';
import { erasedContentBehaviour } from './erased-content-behaviour.ts';
import { noteHolders } from './held-notes.ts';

describe('the in-memory ledger whose content expires', () => {
  erasedContentBehaviour({
    aLedger: (holders) => {
      const { service, eraseExpired } = memoryLedger(undefined, [], holders);
      return Promise.resolve({ ledger: service, eraseExpired });
    },
  });
  expiringContentBehaviour({
    aStore: () => {
      const store = memoryContentStore();
      const { service, eraseExpired } = memoryLedger(undefined, [], noteHolders, store);
      const keeping = { content: service.content, eraseExpired };
      return Promise.resolve({
        ...keeping,
        elsewhere: keeping,
        bytesHeld: (playbook, sha256) => resultOf(store.holds(playbook, sha256)),
      });
    },
  });
  interleavedErasureBehaviour({
    aStore: () => Promise.resolve(memoryContentStore()),
    aKeeping: (store) => {
      const { service, eraseExpired } = memoryLedger(undefined, [], noteHolders, store);
      const keeping = { content: service.content, eraseExpired };
      return Promise.resolve({ ...keeping, elsewhere: keeping });
    },
  });
});
