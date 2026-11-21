import { runIds } from '@on.auto/definitions';
import { memoryLedgerWith } from '@on.auto/operations/testing';

import type { LedgerAt } from './ledgers.ts';
import { placedDefinitions } from './runs.ts';

/** One ledger in memory, which every runtime opened over it shares, as replicas of one ledger do. */
export function memoryLedgerAt(): LedgerAt {
  const { layer } = memoryLedgerWith({ definitionNames: placedDefinitions, runIds });
  return { name: 'memory', layer: () => layer, remove: () => Promise.resolve() };
}
