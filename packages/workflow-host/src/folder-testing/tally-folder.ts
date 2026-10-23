import { type Statement, statement } from '@on.auto/ledger';
import { Effect, Option, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { comparePoints, isAfter, pointIn, pointText, type Point } from '../pages/history-points.ts';
import type { PageEvent, ReadPage } from '../pages/page-events.ts';
import type { FoldedChanges, Folder, Reconciled, Reconciling, RowPhase, Writing } from '../projector/folder.ts';
import type { PlaybookDefinitions } from '../projector/playbook-definitions.ts';

export const tallyType = 'tally';

const talliesTable = statement`CREATE TABLE IF NOT EXISTS folder_tallies (
    playbook_key TEXT NOT NULL,
    tally TEXT NOT NULL,
    saved BIGINT NOT NULL,
    phase TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    checkpoint_at TEXT,
    counted BIGINT NOT NULL CHECK (counted >= 0),
    PRIMARY KEY (playbook_key, tally)
  )`;

const outputsTable = statement`CREATE TABLE IF NOT EXISTS folder_tally_outputs (
    playbook_key TEXT NOT NULL,
    tally TEXT NOT NULL,
    output TEXT NOT NULL,
    counted BIGINT NOT NULL,
    PRIMARY KEY (playbook_key, tally, output)
  )`;

const TallyDetailsSchema = Schema.Struct({
  counts: Schema.String,
  stallsOn: Schema.optionalKey(Schema.String),
});

export type TallyDetails = typeof TallyDetailsSchema.Type;

const TallyKeySchema = Schema.fromJsonString(
  Schema.Struct({ counts: Schema.String, stallsOn: Schema.NullOr(Schema.String) }),
);

const StoredTallySchema = Schema.Struct({
  playbook_key: Schema.String,
  tally: Schema.String,
  saved: WholeNumber,
  phase: Schema.Literals(['waiting', 'rebuilding', 'live', 'stalled']),
  checkpoint: Schema.String,
  checkpoint_at: Schema.NullOr(Schema.String),
  counted: WholeNumber,
});

const TallyNameSchema = Schema.Struct({ tally: Schema.String });

const TalliedOutputSchema = Schema.Struct({ tally: Schema.String, output: Schema.String, counted: WholeNumber });

export type TalliedOutput = typeof TalliedOutputSchema.Type;

const PlaybookKeySchema = Schema.Struct({ playbook_key: Schema.String });

const decodeDetails = Schema.decodeUnknownOption(TallyDetailsSchema);

const decodeKey = Schema.decodeUnknownSync(TallyKeySchema);

interface TallyNext {
  readonly phase: RowPhase;
  readonly checkpoint: Point | undefined;
  readonly checkpointAt: string | null;
  readonly counted: number;
}

export interface TallyRow extends TallyNext {
  readonly playbookKey: string;
  readonly tally: string;
  readonly counts: string;
  readonly stallsOn: string | null;
  readonly saved: number;
  readonly checkpointText: string;
}

type OutputCount = readonly [output: string, counted: number];

export interface TallyChange {
  readonly row: TallyRow;
  readonly next: TallyNext;
  readonly outputs: readonly OutputCount[];
}

export function tallyOf({ counts, stallsOn }: TallyDetails): string {
  return JSON.stringify({ counts, stallsOn: stallsOn ?? null });
}

function tallyRowOf(stored: typeof StoredTallySchema.Type): TallyRow {
  const { counts, stallsOn } = decodeKey(stored.tally);
  return {
    playbookKey: stored.playbook_key,
    tally: stored.tally,
    counts,
    stallsOn,
    saved: stored.saved,
    phase: stored.phase,
    checkpointText: stored.checkpoint,
    checkpoint: pointIn(stored.checkpoint),
    checkpointAt: stored.checkpoint_at,
    counted: stored.counted,
  };
}

export function talliesOf(
  database: HostDatabase,
  playbook: string,
): Effect.Effect<readonly TallyRow[], DatabaseFailed> {
  const read = statement`SELECT playbook_key, tally, saved, phase, checkpoint, checkpoint_at, counted FROM folder_tallies
    WHERE playbook_key = ${playbook} ORDER BY saved, tally`;
  return Effect.map(rowsOf(StoredTallySchema, database.read(read)), (rows) => rows.map((row) => tallyRowOf(row)));
}

export function talliedOutputsOf(
  database: HostDatabase,
  playbook: string,
): Effect.Effect<readonly TalliedOutput[], DatabaseFailed> {
  const read = statement`SELECT tally, output, counted FROM folder_tally_outputs WHERE playbook_key = ${playbook}
    ORDER BY tally, output`;
  return rowsOf(TalliedOutputSchema, database.read(read));
}

function wantedOf({ functions }: PlaybookDefinitions): ReadonlyMap<string, number> {
  const wanted = new Map<string, number>();
  for (const { details, saved } of functions.values()) {
    for (const tally of Option.toArray(decodeDetails(details)).map((each) => tallyOf(each))) {
      wanted.set(tally, Math.min(saved, wanted.get(tally) ?? saved));
    }
  }
  return wanted;
}

function added(playbook: string, tally: string, saved: number, phase: RowPhase): Statement {
  return statement`INSERT INTO folder_tallies (playbook_key, tally, saved, phase, checkpoint, counted)
    VALUES (${playbook}, ${tally}, ${saved}, ${phase}, '', 0) ON CONFLICT (playbook_key, tally) DO NOTHING`;
}

function phased({ playbookKey, tally }: TallyRow, phase: RowPhase): Statement {
  return statement`UPDATE folder_tallies SET phase = ${phase}
    WHERE playbook_key = ${playbookKey} AND tally = ${tally} AND phase IN ('waiting', 'rebuilding')`;
}

function dropped({ playbookKey, tally }: TallyRow): readonly Statement[] {
  return [
    statement`DELETE FROM folder_tally_outputs WHERE playbook_key = ${playbookKey} AND tally = ${tally}`,
    statement`DELETE FROM folder_tallies WHERE playbook_key = ${playbookKey} AND tally = ${tally}`,
  ];
}

function plannedTallies({ playbook, definitions }: Reconciling, rows: readonly TallyRow[]): Reconciled<TallyRow> {
  const wanted = wantedOf(definitions);
  const known = new Set(rows.map(({ tally }) => tally));
  return {
    fresh: [...wanted]
      .filter(([tally]: readonly [string, number]) => !known.has(tally))
      .map(([tally, saved]: readonly [string, number]) => ({
        key: tally,
        saved,
        added: (phase: RowPhase) => added(playbook, tally, saved, phase),
      })),
    dropped: rows.filter(({ tally }) => !wanted.has(tally)),
  };
}

function outputOf({ event }: PageEvent): unknown {
  return Reflect.get(new Object(event.data), 'output');
}

function endOf(row: TallyRow, page: ReadPage): Pick<TallyNext, 'checkpoint' | 'checkpointAt'> {
  const last = page.lastExamined;
  const moved = last !== undefined && comparePoints(last.point, row.checkpoint) > 0;
  return moved
    ? { checkpoint: last.point, checkpointAt: last.recordedAt }
    : { checkpoint: row.checkpoint, checkpointAt: row.checkpointAt };
}

function outputCountsOf(counted: readonly PageEvent[]): readonly OutputCount[] {
  const byOutput = Map.groupBy(counted, (placed) => JSON.stringify(outputOf(placed) ?? null));
  return [...byOutput]
    .map(([output, events]: readonly [string, readonly PageEvent[]]): OutputCount => [output, events.length])
    .toSorted(([one], [other]) => one.localeCompare(other));
}

function foldedTally(row: TallyRow, page: ReadPage): TallyChange {
  const considered = page.events.filter(
    ({ point, event }) => isAfter(point, row.checkpoint) && event.type === row.counts,
  );
  const stalling = considered.find((placed) => row.stallsOn !== null && outputOf(placed) === row.stallsOn);
  if (stalling === undefined) {
    const next = { ...endOf(row, page), phase: row.phase, counted: row.counted + considered.length };
    return { row, next, outputs: outputCountsOf(considered) };
  }
  const counted = considered.slice(0, considered.indexOf(stalling));
  const next: TallyNext = {
    checkpoint: stalling.point,
    checkpointAt: stalling.recordedAt,
    phase: 'stalled',
    counted: row.counted + counted.length,
  };
  return { row, next, outputs: outputCountsOf(counted) };
}

function hasTallyChanged({ row, next }: TallyChange): boolean {
  return (
    next.phase !== row.phase || next.counted !== row.counted || comparePoints(next.checkpoint, row.checkpoint) !== 0
  );
}

function foldedTallies(rows: readonly TallyRow[], page: ReadPage): FoldedChanges<TallyChange> {
  const changes = rows.map((row) => foldedTally(row, page)).filter((change) => hasTallyChanged(change));
  return { changes, resting: [], complete: true, again: false };
}

function outputAdded({ playbookKey, tally }: TallyRow, [output, counted]: OutputCount): Statement {
  return statement`INSERT INTO folder_tally_outputs (playbook_key, tally, output, counted)
    VALUES (${playbookKey}, ${tally}, ${output}, ${counted})
    ON CONFLICT (playbook_key, tally, output) DO UPDATE SET counted = folder_tally_outputs.counted + excluded.counted`;
}

function writtenTally(
  { database }: Writing,
  { row, next, outputs }: TallyChange,
): Effect.Effect<TallyRow | undefined, DatabaseFailed> {
  const moved = statement`UPDATE folder_tallies SET phase = ${next.phase}, checkpoint = ${pointText(next.checkpoint)},
      checkpoint_at = ${next.checkpointAt}, counted = ${next.counted}
    WHERE playbook_key = ${row.playbookKey} AND tally = ${row.tally} AND checkpoint = ${row.checkpointText}
    RETURNING tally`;
  const written = database.transaction([...outputs.map((counted) => outputAdded(row, counted)), moved]);
  return Effect.map(rowsOf(TallyNameSchema, written), (took) =>
    took.length === 0 ? undefined : { ...row, ...next, checkpointText: pointText(next.checkpoint) },
  );
}

export function tallyFolderOf(rebuildsAtOnce: number): Folder<TallyRow, TallyChange> {
  return {
    definitionType: tallyType,
    tables: [talliesTable, outputsTable],
    rebuildsAtOnce,
    keptOf: (details) => details,
    keyOf: ({ tally }) => tally,
    typesOf: ({ counts }) => [counts],
    playbooksWithRows: (database) =>
      Effect.map(
        rowsOf(
          PlaybookKeySchema,
          database.read(statement`SELECT DISTINCT playbook_key FROM folder_tallies ORDER BY playbook_key`),
        ),
        (rows) => rows.map(({ playbook_key: playbookKey }) => playbookKey),
      ),
    rowsOf: talliesOf,
    reconcile: plannedTallies,
    dropped,
    phased,
    fold: (rows, page) => Effect.succeed(foldedTallies(rows, page)),
    write: writtenTally,
    unchanged: (row) => ({
      row,
      next: { phase: row.phase, checkpoint: row.checkpoint, checkpointAt: row.checkpointAt, counted: row.counted },
      outputs: [],
    }),
    joinedLive: (change) => ({ ...change, next: { ...change.next, phase: 'live' } }),
    hasChanged: hasTallyChanged,
  };
}
