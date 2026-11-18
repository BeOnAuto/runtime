import { describe } from 'vitest';

import { memoryLedgerWith } from '../testing/memory-ledger.ts';
import { definitionRowsBehaviour } from './definition-rows-behaviour.ts';

describe('the in-memory ledger', () => {
  definitionRowsBehaviour((projections, definitionNames) =>
    Promise.resolve(memoryLedgerWith({ projections, definitionNames }).service),
  );
});
