import { describe } from 'vitest';

import { memoryLedgerWith } from '../testing/memory-ledger.ts';
import { runIdsBehaviour } from './run-ids-behaviour.ts';

describe('the in-memory ledger', () => {
  runIdsBehaviour((runIds) => Promise.resolve(memoryLedgerWith({ runIds }).service));
});
