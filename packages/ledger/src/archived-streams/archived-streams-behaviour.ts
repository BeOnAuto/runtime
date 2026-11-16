import { describe } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { archivedAppendBehaviour, type AppendedToAnArchivedName } from './archived-appends-behaviour.ts';
import { archivedFillsBehaviour } from './archived-fills-behaviour.ts';
import { archivedReadsBehaviour } from './archived-reads-behaviour.ts';

export function archivedStreamsBehaviour(entry: LedgerEntry, appendedToAnArchivedName: AppendedToAnArchivedName): void {
  describe('a stream archived by the event store’s own mark, read by every read port as a stream never written', () => {
    archivedReadsBehaviour(entry);
    archivedFillsBehaviour(entry);
  });

  describe('an append to the name of an archived stream', () => {
    archivedAppendBehaviour(entry, appendedToAnArchivedName);
  });
}
