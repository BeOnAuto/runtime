import { memoryLedger, memoryLedgerWith } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { recordedBehaviour } from '../testing/recorded-behaviour.ts';

describe('The in-memory ledger of the application layer', () => {
  recordedBehaviour(
    () => Promise.resolve(memoryLedger().service),
    (names) => Promise.resolve(memoryLedgerWith({ definitionNames: names }).service),
  );
});
