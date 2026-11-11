import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { Layer } from 'effect';

import { sqliteLedgerReadsOn } from './connection/sqlite-reads.ts';
import type { LedgerServices, StoreLayerOptions } from './ledger-layer.ts';
import { sqliteLedgerFileOn, type SQLiteLedgerFile } from './secrets/sqlite-ledger-file.ts';

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
  streamProjections,
  mostBytesFilledAtOnce,
  holders,
  layoutSteps,
  factSchemas,
  appends,
  content,
  observer,
  appended,
}: LedgerOptions): Layer.Layer<LedgerServices> {
  return sqliteLedgerFile(fileName).ledgerLayer({
    runOutcomes,
    projections,
    streamProjections,
    mostBytesFilledAtOnce,
    holders,
    layoutSteps,
    factSchemas,
    appends,
    content,
    observer,
    appended,
  });
}

export function sqliteLedgerFile(fileName: string): SQLiteLedgerFile {
  return sqliteLedgerFileOn(
    { optionsOf: () => sqlite3OptionsOf(fileName), inMemory: fileName === privateMemory },
    fileName,
  );
}

export function sqliteLedgerReads({ fileName }: Pick<LedgerOptions, 'fileName'>) {
  return sqliteLedgerReadsOn(() => sqlite3OptionsOf(fileName));
}
