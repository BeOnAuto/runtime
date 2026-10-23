import { type Statement, statement } from '@on.auto/ledger';
import type { Schema } from 'effect';

import { pointText } from '../pages/history-points.ts';
import type { RowPhase } from '../projector/folder.ts';
import type { FoldedEvent, ViewRow, ViewStall } from './view-rows.ts';

export interface NewView {
  readonly playbookKey: string;
  readonly name: string;
  readonly version: number;
  readonly saved: number;
  readonly details: string;
  readonly phase: RowPhase;
  readonly view: string;
}

export interface FoldedRow {
  readonly view?: Schema.Json;
  readonly checkpoint: ViewRow['checkpoint'];
  readonly checkpointAt: string | null;
  readonly lastEvent: FoldedEvent | null;
  readonly folded: number;
  readonly overtimes: number;
  readonly phase: RowPhase;
  readonly stall?: ViewStall;
}

export const viewsTable = statement`CREATE TABLE IF NOT EXISTS recall_views (
    playbook_key TEXT NOT NULL,
    name TEXT NOT NULL,
    version BIGINT NOT NULL,
    saved BIGINT NOT NULL,
    details TEXT NOT NULL,
    phase TEXT NOT NULL,
    view TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    checkpoint_at TEXT,
    last_event_id TEXT,
    last_event_at TEXT,
    folded BIGINT NOT NULL,
    overtimes INTEGER NOT NULL,
    stalled_event_id TEXT,
    stalled_event_type TEXT,
    stalled_event_at TEXT,
    stalled_kind TEXT,
    stalled_message TEXT,
    stalled_line INTEGER,
    PRIMARY KEY (playbook_key, name)
  )`;

export function viewsOfPlaybook(playbookKey: string): Statement {
  return statement`SELECT playbook_key, name, version, saved, details, phase, checkpoint, checkpoint_at, last_event_id,
      last_event_at, folded, overtimes, stalled_event_id, stalled_event_type, stalled_event_at, stalled_kind,
      stalled_message, stalled_line
    FROM recall_views WHERE playbook_key = ${playbookKey} ORDER BY saved, name`;
}

export function viewToFold({ playbookKey, name, version, checkpointText }: ViewRow): Statement {
  return statement`SELECT view FROM recall_views
    WHERE playbook_key = ${playbookKey} AND name = ${name} AND version = ${version} AND checkpoint = ${checkpointText}`;
}

export function viewNamed(playbookKey: string, name: string): Statement {
  return statement`SELECT * FROM recall_views WHERE playbook_key = ${playbookKey} AND name = ${name}`;
}

export const playbooksWithViews = statement`SELECT DISTINCT playbook_key FROM recall_views ORDER BY playbook_key`;

export function viewAdded({ playbookKey, name, version, saved, details, phase, view }: NewView): Statement {
  return statement`INSERT INTO recall_views (playbook_key, name, version, saved, details, phase, view, checkpoint, folded, overtimes)
    VALUES (${playbookKey}, ${name}, ${version}, ${saved}, ${details}, ${phase}, ${view}, '', 0, 0)
    ON CONFLICT (playbook_key, name) DO NOTHING`;
}

export function viewRenewed({ playbookKey, name, version, saved, details, phase, view }: NewView): Statement {
  return statement`UPDATE recall_views SET version = ${version}, saved = ${saved}, details = ${details},
      phase = ${phase}, view = ${view}, checkpoint = '', checkpoint_at = NULL, last_event_id = NULL,
      last_event_at = NULL, folded = 0, overtimes = 0, stalled_event_id = NULL, stalled_event_type = NULL,
      stalled_event_at = NULL, stalled_kind = NULL, stalled_message = NULL, stalled_line = NULL
    WHERE playbook_key = ${playbookKey} AND name = ${name} AND version < ${version}`;
}

export function viewDropped(playbookKey: string, name: string): Statement {
  return statement`DELETE FROM recall_views WHERE playbook_key = ${playbookKey} AND name = ${name}`;
}

export function phaseSet({ playbookKey, name, version }: ViewRow, phase: RowPhase): Statement {
  return statement`UPDATE recall_views SET phase = ${phase}
    WHERE playbook_key = ${playbookKey} AND name = ${name} AND version = ${version} AND phase IN ('waiting', 'rebuilding')`;
}

const noLastEvent = { id: null, time: null };

const noStall = { id: null, type: null, time: null, kind: null, message: null, line: null };

function stallColumns(stall: ViewStall | undefined) {
  return stall === undefined ? noStall : { ...stall.event, kind: stall.kind, message: stall.message, line: stall.line };
}

function movedWritten(read: ViewRow, folded: FoldedRow): Statement {
  const lastEvent = folded.lastEvent ?? noLastEvent;
  const stall = stallColumns(folded.stall);
  return statement`UPDATE recall_views SET checkpoint = ${pointText(folded.checkpoint)},
      checkpoint_at = ${folded.checkpointAt}, last_event_id = ${lastEvent.id}, last_event_at = ${lastEvent.time},
      folded = ${folded.folded}, overtimes = ${folded.overtimes}, phase = ${folded.phase},
      stalled_event_id = ${stall.id}, stalled_event_type = ${stall.type}, stalled_event_at = ${stall.time},
      stalled_kind = ${stall.kind}, stalled_message = ${stall.message}, stalled_line = ${stall.line}
    WHERE playbook_key = ${read.playbookKey} AND name = ${read.name} AND version = ${read.version}
      AND checkpoint = ${read.checkpointText}
    RETURNING name`;
}

export function foldedWritten(read: ViewRow, folded: FoldedRow): Statement {
  if (folded.view === undefined) {
    return movedWritten(read, folded);
  }
  const lastEvent = folded.lastEvent ?? noLastEvent;
  const stall = stallColumns(folded.stall);
  return statement`UPDATE recall_views SET view = ${JSON.stringify(folded.view)}, checkpoint = ${pointText(folded.checkpoint)},
      checkpoint_at = ${folded.checkpointAt}, last_event_id = ${lastEvent.id}, last_event_at = ${lastEvent.time},
      folded = ${folded.folded}, overtimes = ${folded.overtimes}, phase = ${folded.phase},
      stalled_event_id = ${stall.id}, stalled_event_type = ${stall.type}, stalled_event_at = ${stall.time},
      stalled_kind = ${stall.kind}, stalled_message = ${stall.message}, stalled_line = ${stall.line}
    WHERE playbook_key = ${read.playbookKey} AND name = ${read.name} AND version = ${read.version}
      AND checkpoint = ${read.checkpointText}
    RETURNING name`;
}
