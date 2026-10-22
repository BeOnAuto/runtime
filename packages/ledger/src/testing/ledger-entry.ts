import type { Ledger, RunOutcomeMapping, KeyedProjection } from '@on.auto/operations';
import type { Layer } from 'effect';
import { onTestFinished } from 'vitest';

import type { LedgerStore, RecordedStore, StatementExecutor } from '../event-store.ts';
import type { LayoutDialect } from '../layout/layout-dialects.ts';
import { openLedgerWith } from './open-ledger.ts';

export interface LedgerEntry {
  readonly mostEventsInOneAppend: number;
  readonly afterClosing: string;
  readonly closedWhileWriting: string;
  readonly aDatabase: () => Promise<string>;
  readonly ledgerOn: (
    database: string,
    runOutcomes?: RunOutcomeMapping,
    projections?: readonly KeyedProjection[],
  ) => Layer.Layer<Ledger>;
  readonly storeOn: (database: string) => LedgerStore;
  readonly queried: (database: string, statement: string) => Promise<readonly unknown[]>;
  readonly executedOn: <A>(database: string, work: (execute: StatementExecutor) => Promise<A>) => Promise<A>;
  readonly layout: LayoutDialect;
  readonly definitionStreamsIndexed: (database: string) => Promise<boolean>;
  readonly planOf: (database: string, read: (store: RecordedStore) => Promise<unknown>) => Promise<string>;
  readonly throughTheKindIndex: string;
  readonly throughTheIdIndex: string;
  readonly outcomeTables: string;
  readonly projectionTables: string;
  readonly projectionIndexes: string;
  readonly topicTables: string;
}

export async function aLedger(
  entry: LedgerEntry,
  database?: string,
  runOutcomes?: RunOutcomeMapping,
  projections?: readonly KeyedProjection[],
): Promise<Ledger['Service']> {
  const { ledger, dispose } = await openLedgerWith(
    entry.ledgerOn(database ?? (await entry.aDatabase()), runOutcomes, projections),
  );
  onTestFinished(dispose);
  return ledger;
}

export async function aStore(entry: LedgerEntry): Promise<LedgerStore> {
  const store = entry.storeOn(await entry.aDatabase());
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

export const tallies = 'org/acme/tallies';

export const changedWhileDeciding = 'The state changed while the command was decided';
