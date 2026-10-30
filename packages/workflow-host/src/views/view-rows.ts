import { recordedCursorOf } from '@on.auto/ledger';
import type { StallKind } from '@on.auto/workflow-engine/dsl';
import { Schema } from 'effect';

import { WholeNumber } from '../database/host-database.ts';
import { pointIn, type Point } from '../pages/history-points.ts';
import type { RowPhase } from '../projector/folder.ts';
import { ViewDetailsSchema, type ViewDetails } from './view-details.ts';

export type StallCause = StallKind | 'time' | 'memory' | 'crash';

export interface StalledEvent {
  readonly id: string;
  readonly type: string;
  readonly time: string;
}

export interface ViewStall {
  readonly event: StalledEvent;
  readonly kind: StallCause;
  readonly message: string;
  readonly line: number | null;
}

export interface FoldedEvent {
  readonly id: string;
  readonly time: string;
}

export interface KeptView {
  readonly name: string;
  readonly version: number;
  readonly phase: RowPhase;
  readonly view: Schema.Json;
  readonly checkpoint: string | null;
  readonly checkpointAt: string | null;
  readonly lastEvent: FoldedEvent | null;
  readonly folded: number;
  readonly stall?: ViewStall;
}

export interface ViewRow {
  readonly playbookKey: string;
  readonly name: string;
  readonly version: number;
  readonly saved: number;
  readonly details: ViewDetails;
  readonly phase: RowPhase;
  readonly checkpointText: string;
  readonly checkpoint: Point | undefined;
  readonly checkpointAt: string | null;
  readonly lastEvent: FoldedEvent | null;
  readonly folded: number;
  readonly overtimes: number;
  readonly stall?: ViewStall;
}

const PhaseSchema = Schema.Literals(['waiting', 'rebuilding', 'live', 'stalled']);

const StallCauseSchema = Schema.Literals([
  'raised',
  'work',
  'unfit',
  'size',
  'schema',
  'refused',
  'time',
  'memory',
  'crash',
]);

const Text = Schema.NullOr(Schema.String);

const rowFields = {
  playbook_key: Schema.String,
  name: Schema.String,
  version: WholeNumber,
  saved: WholeNumber,
  details: Schema.fromJsonString(ViewDetailsSchema),
  phase: PhaseSchema,
  checkpoint: Schema.String,
  checkpoint_at: Text,
  last_event_id: Text,
  last_event_at: Text,
  folded: WholeNumber,
  overtimes: WholeNumber,
  stalled_event_id: Text,
  stalled_event_type: Text,
  stalled_event_at: Text,
  stalled_kind: Schema.NullOr(StallCauseSchema),
  stalled_message: Text,
  stalled_line: Schema.NullOr(WholeNumber),
};

export const ViewRowSchema = Schema.Struct(rowFields);

export const KeptRowSchema = Schema.Struct({ ...rowFields, view: Schema.fromJsonString(Schema.Json) });

export const FoldedViewSchema = Schema.Struct({ view: Schema.fromJsonString(Schema.Json) });

type StoredRow = typeof ViewRowSchema.Type;

function lastEventOf({ last_event_id: id, last_event_at: time }: StoredRow): FoldedEvent | null {
  return id === null || time === null ? null : { id, time };
}

function stallOf(row: StoredRow): ViewStall | undefined {
  const { stalled_event_id: id, stalled_event_type: type, stalled_event_at: time, stalled_kind: kind } = row;
  const { stalled_message: message, stalled_line: line } = row;
  if (id === null || type === null || time === null || kind === null || message === null) {
    return undefined;
  }
  return { event: { id, type, time }, kind, message, line };
}

export function viewRowOf(row: StoredRow): ViewRow {
  const stall = stallOf(row);
  return {
    playbookKey: row.playbook_key,
    name: row.name,
    version: row.version,
    saved: row.saved,
    details: row.details,
    phase: row.phase,
    checkpointText: row.checkpoint,
    checkpoint: pointIn(row.checkpoint),
    checkpointAt: row.checkpoint_at,
    lastEvent: lastEventOf(row),
    folded: row.folded,
    overtimes: row.overtimes,
    ...(stall === undefined ? {} : { stall }),
  };
}

export function keptViewOf({ playbookKey, checkpoint, ...row }: ViewRow, view: Schema.Json): KeptView {
  return {
    name: row.name,
    version: row.version,
    phase: row.phase,
    view,
    checkpoint: checkpoint === undefined ? null : recordedCursorOf(playbookKey, checkpoint),
    checkpointAt: row.checkpointAt,
    lastEvent: row.lastEvent,
    folded: row.folded,
    ...(row.stall === undefined ? {} : { stall: row.stall }),
  };
}
