import type { Statement } from '@on.auto/ledger';
import type { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import type { Point } from '../pages/history-points.ts';
import type { ReadPage } from '../pages/page-events.ts';
import type { PlaybookDefinitions, KeptOf } from './playbook-definitions.ts';

export type RowPhase = 'waiting' | 'rebuilding' | 'live' | 'stalled';

export interface RowStanding {
  readonly phase: RowPhase;
  readonly checkpoint: Point | undefined;
}

export interface PassedRow extends RowStanding {
  readonly saved: number;
}

export interface PassedChange<Row> {
  readonly row: Row;
  readonly next: RowStanding;
}

export interface FoldedChanges<Change> {
  readonly changes: readonly Change[];
  readonly resting: readonly string[];
  readonly complete: boolean;
  readonly again: boolean;
  readonly trouble?: string;
}

export interface Reconciling {
  readonly playbook: string;
  readonly definitions: PlaybookDefinitions;
}

export interface FreshRow {
  readonly key: string;
  readonly saved: number;
  readonly added: (phase: RowPhase) => Statement;
}

export interface Reconciled<Row> {
  readonly fresh: readonly FreshRow[];
  readonly dropped: readonly Row[];
}

export interface Writing {
  readonly database: Pick<HostDatabase, 'write' | 'transaction' | 'mostBoundValues'>;
  readonly playbook: string;
  readonly note: (note: HostNote) => Effect.Effect<void>;
}

export interface Folder<Row extends PassedRow, Change extends PassedChange<Row>> {
  readonly definitionType: string;
  readonly tables: readonly Statement[];
  readonly rebuildsAtOnce: number;
  readonly keptOf: KeptOf;
  readonly keyOf: (row: Row) => string;
  readonly typesOf: (row: Row) => readonly string[];
  readonly playbooksWithRows: (database: HostDatabase) => Effect.Effect<readonly string[], DatabaseFailed>;
  readonly rowsOf: (database: HostDatabase, playbook: string) => Effect.Effect<readonly Row[], DatabaseFailed>;
  readonly reconcile: (reconciling: Reconciling, rows: readonly Row[]) => Reconciled<Row>;
  readonly dropped: (row: Row) => readonly Statement[];
  readonly phased: (row: Row, phase: RowPhase) => Statement;
  readonly fold: (
    rows: readonly Row[],
    page: ReadPage,
    database: HostDatabase,
  ) => Effect.Effect<FoldedChanges<Change>, DatabaseFailed>;
  readonly write: (writing: Writing, change: Change) => Effect.Effect<Row | undefined, DatabaseFailed>;
  readonly unchanged: (row: Row) => Change;
  readonly joinedLive: (change: Change) => Change;
  readonly hasChanged: (change: Change) => boolean;
}

export type SomeFolder = <Result>(
  use: <Row extends PassedRow, Change extends PassedChange<Row>>(folder: Folder<Row, Change>) => Result,
) => Result;

export function someFolder<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
): SomeFolder {
  return (use) => use(folder);
}

export function tablesOf(folders: readonly SomeFolder[]): readonly Statement[] {
  return folders.flatMap((some) => some((folder) => folder.tables));
}
