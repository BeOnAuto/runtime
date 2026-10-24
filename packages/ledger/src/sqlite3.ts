import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { Layer } from 'effect';

import { sqliteLedgerLayer } from './connection/sqlite-opening.ts';
import { sqliteLedgerReadsOn } from './connection/sqlite-reads.ts';
import type { LedgerServices, StoreLayerOptions } from './ledger-layer.ts';
import { sqliteSecretRowsOn, type SecretRowsOptions } from './secrets/sqlite-secret-rows.ts';

export { aSQLiteFileInLayout } from './layout/sqlite-file-in-layout.ts';

export interface LedgerOptions extends StoreLayerOptions {
  readonly fileName: string;
}

const pageCacheOfEightMebibytes = -8192;

export const modestConnections: {
  readonly pragmaOptions: { readonly cache_size: number; readonly mmap_size: number };
} = {
  pragmaOptions: { cache_size: pageCacheOfEightMebibytes, mmap_size: 0 },
};

const privateMemory = ':memory:';

function prepareDirectoryOf(fileName: string): void {
  if (fileName !== privateMemory) {
    mkdirSync(dirname(fileName), { recursive: true });
  }
}

function sqlite3OptionsOf(fileName: string) {
  prepareDirectoryOf(fileName);
  return { driver: sqlite3EventStoreDriver, fileName, connectionOptions: modestConnections };
}

export function ledgerLayer({
  fileName,
  runOutcomes,
  projections,
  appends,
  content,
  observer,
  appended,
}: LedgerOptions): Layer.Layer<LedgerServices> {
  return sqliteLedgerLayer(
    { optionsOf: () => sqlite3OptionsOf(fileName), inMemory: fileName === privateMemory },
    { runOutcomes, projections, appends, content, observer, appended },
  );
}

export function sqliteSecretRows({ fileName }: SecretRowsOptions) {
  return sqliteSecretRowsOn(() => sqlite3OptionsOf(fileName));
}

export function sqliteLedgerReads({ fileName }: Pick<LedgerOptions, 'fileName'>) {
  return sqliteLedgerReadsOn(() => sqlite3OptionsOf(fileName));
}
