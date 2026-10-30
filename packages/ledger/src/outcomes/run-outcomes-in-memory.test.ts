import { memoryLedger } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { runOutcomesBehaviour } from './run-outcomes-behaviour.ts';

describe('The in-memory ledger of the application layer', () => {
  runOutcomesBehaviour((runOutcomes) => Promise.resolve(memoryLedger(runOutcomes).service));
});
