import type { ContentHolders, Ledger, RunOutcomeMapping, KeptProjection, StreamProjection } from '@on.auto/operations';
import type { Layer } from 'effect';
import { onTestFinished } from 'vitest';

import type { LedgerConnection } from '../connection/ledger-connection.ts';
import type { LedgerStore, RecordedStore, StatementExecutor } from '../event-store.ts';
import type { LayoutDialect } from '../layout/layout-dialects.ts';
import type { LayoutCarrying } from '../layout/layout-steps.ts';
import type { LedgerServices, OpenedLedger, OpenedWith } from '../ledger-layer.ts';
import type { StreamSignal } from '../signal/append-signal.ts';
import { openChoresWith, openLedgerWith, type OpenChores } from './open-ledger.ts';

export interface StreamKept {
  readonly streamProjections: readonly StreamProjection[];
  readonly mostBytesFilledAtOnce?: number;
}

export interface LedgerEntry {
  readonly mostEventsInOneAppend: number;
  readonly afterClosing: string;
  readonly closedWhileWriting: string;
  readonly aDatabase: () => Promise<string>;
  readonly ledgerOn: (
    database: string,
    runOutcomes?: RunOutcomeMapping,
    projections?: readonly KeptProjection[],
    holders?: ContentHolders,
  ) => Layer.Layer<Exclude<LedgerServices, LedgerConnection>>;
  readonly streamLedgerOn: (
    database: string,
    kept: StreamKept,
  ) => Layer.Layer<Exclude<LedgerServices, LedgerConnection>>;
  readonly ledgerOutsideOn: (
    database: string,
    holders: ContentHolders,
    content: NonNullable<OpenedWith['content']>,
  ) => Layer.Layer<LedgerServices>;
  readonly ledgerRaisingOn: (database: string, appended: StreamSignal) => Layer.Layer<Ledger | LedgerConnection>;
  readonly storeOn: (database: string) => LedgerStore;
  readonly openedOn: (database: string) => OpenedLedger;
  readonly queried: (database: string, statement: string) => Promise<readonly unknown[]>;
  readonly executedOn: <A>(database: string, work: (execute: StatementExecutor) => Promise<A>) => Promise<A>;
  readonly layout: LayoutDialect;
  readonly carriedOn: (database: string, carrying: LayoutCarrying) => Promise<void>;
  readonly definitionStreamsIndexed: (database: string) => Promise<boolean>;
  readonly planOf: (database: string, read: (store: RecordedStore) => Promise<unknown>) => Promise<string>;
  readonly statementPlanOf: (database: string, statement: Parameters<StatementExecutor['query']>[0]) => Promise<string>;
  readonly throughTheKindIndex: string;
  readonly throughTheIdIndex: string;
  readonly throughTheExpiringIndex: string;
  readonly stepsOfAScanOrASort: readonly string[];
  readonly throughTheUploadIndex: string;
  readonly updatesCountingOf: (table: string, column: string) => readonly string[];
  readonly outcomeTables: string;
  readonly projectionTables: string;
  readonly projectionIndexes: string;
  readonly topicTables: string;
  readonly labelledTables: string;
}

async function opened(layer: ReturnType<LedgerEntry['ledgerOn']>): Promise<Ledger['Service']> {
  const { ledger, dispose } = await openLedgerWith(layer);
  onTestFinished(dispose);
  return ledger;
}

export async function aLedger(
  entry: LedgerEntry,
  database?: string,
  runOutcomes?: RunOutcomeMapping,
  projections?: readonly KeptProjection[],
): Promise<Ledger['Service']> {
  return opened(entry.ledgerOn(database ?? (await entry.aDatabase()), runOutcomes, projections));
}

export async function aLedgerHolding(
  entry: LedgerEntry,
  holders: ContentHolders,
  database?: string,
): Promise<Ledger['Service']> {
  return opened(entry.ledgerOn(database ?? (await entry.aDatabase()), undefined, [], holders));
}

export async function aLedgerOutside(
  entry: LedgerEntry,
  holders: ContentHolders,
  content: NonNullable<OpenedWith['content']>,
  database?: string,
): Promise<Ledger['Service']> {
  return opened(entry.ledgerOutsideOn(database ?? (await entry.aDatabase()), holders, content));
}

async function openedErasing(layer: Parameters<typeof openChoresWith>[0]): Promise<OpenChores> {
  const chores = await openChoresWith(layer);
  onTestFinished(chores.dispose);
  return chores;
}

export async function anErasingLedger(
  entry: LedgerEntry,
  holders: ContentHolders,
  database?: string,
): Promise<OpenChores> {
  return openedErasing(entry.ledgerOn(database ?? (await entry.aDatabase()), undefined, [], holders));
}

export async function anErasingLedgerOutside(
  entry: LedgerEntry,
  holders: ContentHolders,
  content: NonNullable<OpenedWith['content']>,
  database?: string,
): Promise<OpenChores> {
  return openedErasing(entry.ledgerOutsideOn(database ?? (await entry.aDatabase()), holders, content));
}

export async function aStore(entry: LedgerEntry): Promise<LedgerStore> {
  const store = entry.storeOn(await entry.aDatabase());
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

export function sqliteUpdatesCountingOf(table: string, column: string): readonly string[] {
  return [
    'CREATE TABLE IF NOT EXISTS counted_updates (column_name TEXT NOT NULL)',
    `CREATE TRIGGER counted_updates_of_${column} AFTER UPDATE OF ${column} ON ${table}
      BEGIN INSERT INTO counted_updates (column_name) VALUES ('${column}'); END`,
  ];
}

export const tallies = 'org/acme/tallies';

export const changedWhileDeciding = 'The state changed while the command was decided';
