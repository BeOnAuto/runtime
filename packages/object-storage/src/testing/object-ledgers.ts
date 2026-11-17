import { memoryLedger, type InterleavedRemovalEntry, type UnheldContentEntry } from '@on.auto/operations/testing';

import { objectContentOn } from '../content/object-content.ts';
import { bucketOnS3 } from '../s3/s3-bucket.ts';
import type { ObjectStoreEntry } from './object-store-entry.ts';

export type LedgerOver = InterleavedRemovalEntry['aLedger'];

export const inMemory: LedgerOver = (holders, content) =>
  Promise.resolve(memoryLedger(undefined, [], holders, content).service);

async function objectStoreOf(entry: ObjectStoreEntry) {
  const store = await entry.aStore();
  return objectContentOn(bucketOnS3(store.bucket), store.location);
}

export function unheldEntryOf(entry: ObjectStoreEntry, ledgerOver: LedgerOver): UnheldContentEntry {
  return { aLedger: async (holders) => ledgerOver(holders, await objectStoreOf(entry)) };
}

export function interleavedEntryOf(entry: ObjectStoreEntry, ledgerOver: LedgerOver): InterleavedRemovalEntry {
  return { aStore: () => objectStoreOf(entry), aLedger: ledgerOver };
}
