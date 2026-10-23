import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { ContentStore, RunOutcomeMapping, KeyedProjection } from '@on.auto/operations';
import type { Layer } from 'effect';

import type { AppendSignal } from './appends/append-signal.ts';
import { sqliteLedgerLayer } from './connection/sqlite-opening.ts';
import type { AppendObserver } from './event-store.ts';
import type { LedgerServices } from './ledger-layer.ts';
import { sqliteSecretRowsOn, type SecretRowsOptions } from './secrets/sqlite-secret-rows.ts';

export interface LedgerOptions {
  readonly fileName: string;
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
  readonly observer?: AppendObserver | undefined;
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
}: LedgerOptions): Layer.Layer<LedgerServices> {
  return sqliteLedgerLayer(
    { optionsOf: () => sqlite3OptionsOf(fileName), inMemory: fileName === privateMemory },
    { runOutcomes, projections, appends, content, observer },
  );
}

export function sqliteSecretRows({ fileName }: SecretRowsOptions) {
  return sqliteSecretRowsOn(() => sqlite3OptionsOf(fileName));
}
