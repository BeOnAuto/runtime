import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { Layer } from 'effect';

import type { LedgerServices, StoreLayerOptions } from '../ledger-layer.ts';
import { sqliteLedgerFileOn, type SQLiteLedgerFile } from '../secrets/sqlite-ledger-file.ts';
import type { LedgerReads } from './ledger-connection.ts';
import type { NodeSqliteEventStoreDriver } from './node-sqlite-event-store-driver.ts';
import { sqliteLedgerReadsOn } from './sqlite-reads.ts';

export type SQLiteFileDriver = typeof sqlite3EventStoreDriver | NodeSqliteEventStoreDriver;

export interface LedgerOptions extends StoreLayerOptions {
  readonly fileName: string;
}

export interface SQLiteFileLedger {
  readonly ledgerLayer: (options: LedgerOptions) => Layer.Layer<LedgerServices>;
  readonly sqliteLedgerFile: (fileName: string) => SQLiteLedgerFile;
  readonly sqliteLedgerReads: (options: Pick<LedgerOptions, 'fileName'>) => LedgerReads;
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

export function sqliteFileLedgerOn(theDriver: () => SQLiteFileDriver): SQLiteFileLedger {
  const optionsOf = (fileName: string) => {
    prepareDirectoryOf(fileName);
    return { driver: theDriver(), fileName, connectionOptions: modestConnections };
  };
  const sqliteLedgerFile = (fileName: string): SQLiteLedgerFile =>
    sqliteLedgerFileOn({ optionsOf: () => optionsOf(fileName), inMemory: fileName === privateMemory }, fileName);
  return {
    ledgerLayer: ({
      fileName,
      runOutcomes,
      projections,
      streamProjections,
      mostBytesFilledAtOnce,
      holders,
      layoutSteps,
      factSchemas,
      floor,
      definitionNames,
      appends,
      content,
      observer,
      appended,
    }) =>
      sqliteLedgerFile(fileName).ledgerLayer({
        runOutcomes,
        projections,
        streamProjections,
        mostBytesFilledAtOnce,
        holders,
        layoutSteps,
        factSchemas,
        floor,
        definitionNames,
        appends,
        content,
        observer,
        appended,
      }),
    sqliteLedgerFile,
    sqliteLedgerReads: ({ fileName }) => sqliteLedgerReadsOn(() => optionsOf(fileName)),
  };
}
