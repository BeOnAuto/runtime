import { recordedContentBehaviour } from '@on.auto/content/testing';
import { interleavedRemovalBehaviour, unheldContentBehaviour } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { fakeBucket, type FakeBucketOptions } from '../testing/fake-bucket.ts';
import { objectContentBehaviour } from '../testing/object-content-behaviour.ts';
import {
  inMemory,
  interleavedEntryOf,
  onPostgreSQL,
  onSQLite,
  unheldEntryOf,
  type LedgerOver,
} from '../testing/object-ledgers.ts';
import { contentEntryOf, objectStoreEntry } from '../testing/object-store-entry.ts';

function onAFakeBucket(options: FakeBucketOptions) {
  return objectStoreEntry(() => {
    const bucket = fakeBucket(options);
    const [writing, reading] = [bucket.client(), bucket.client()];
    return Promise.resolve({ writing: () => writing, reading: () => reading, bucket: 'content' });
  });
}

const stores: readonly (readonly [string, FakeBucketOptions])[] = [
  ['that honours a conditional copy', { pageSize: 2 }],
  ['that ignores a conditional copy', { pageSize: 2, honoursConditionalCopy: false }],
];

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const ledgers: readonly (readonly [string, LedgerOver])[] = [
  ['in memory', inMemory],
  ['on SQLite', onSQLite],
];

function keptByALedger(ledgerOver: LedgerOver): void {
  unheldContentBehaviour(unheldEntryOf(onAFakeBucket({ pageSize: 2 }), ledgerOver));
  interleavedRemovalBehaviour(interleavedEntryOf(onAFakeBucket({ pageSize: 2 }), ledgerOver));
}

describe.each(stores)('The content kept on a fake object store %s', (_store, options) => {
  recordedContentBehaviour(contentEntryOf(onAFakeBucket(options)));
  objectContentBehaviour(onAFakeBucket(options));
});

describe.each(ledgers)('The content a ledger %s keeps on a fake object store', (_ledger, ledgerOver) => {
  keptByALedger(ledgerOver);
});

describe.skipIf(server === '')('The content a ledger on PostgreSQL keeps on a fake object store', () => {
  keptByALedger(onPostgreSQL(server));
});
