import type { StoredPlace } from '@on.auto/ledger';
import type { FoldedView, FoldStall } from '@on.auto/workflow-engine/dsl';
import { Struct, type Schema } from 'effect';

import { lineInDocument } from '../views/view-details.ts';
import type { FoldedEvent, StallCause, ViewRow, ViewStall } from '../views/view-rows.ts';
import type { FoldedRow } from '../views/view-statements.ts';
import { comparePoints, pointText, type Point } from './history-points.ts';
import type { PageEvent, ReadPage } from './page-events.ts';

export interface ViewChange {
  readonly row: ViewRow;
  readonly next: FoldedRow;
}

export interface Retries {
  readonly overtimesBeforeStall: number;
  readonly foldDeadlineMs: number;
}

export interface FoldedPageOf {
  readonly page: ReadPage;
  readonly early: boolean;
  readonly retries: Retries;
}

export interface Try {
  readonly page: ReadPage;
  readonly at: number;
  readonly kind: StallCause;
  readonly retries: Retries;
}

interface Place {
  readonly point: Point | undefined;
  readonly at: string | null;
}

interface Advance {
  readonly view?: Schema.Json;
  readonly folded: number;
  readonly lastEvent: FoldedEvent | null;
}

function placeOfRow(row: ViewRow): Place {
  return { point: row.checkpoint, at: row.checkpointAt };
}

function laterOf(row: ViewRow, place: Place): Place {
  return comparePoints(place.point, row.checkpoint) > 0 ? place : placeOfRow(row);
}

function placeOfEvent(event: PageEvent | undefined): Place {
  return event === undefined ? { point: undefined, at: null } : { point: event.point, at: event.recordedAt };
}

function placeOfStore(place: StoredPlace | undefined): Place {
  return place === undefined ? { point: undefined, at: null } : { point: place.point, at: place.recordedAt };
}

function before(row: ViewRow, page: ReadPage, index: number): Place {
  return laterOf(row, placeOfEvent(page.events[index - 1]));
}

function stalledEventOf(page: ReadPage, index: number): ViewStall['event'] {
  const event = page.events[index]?.event;
  return { id: String(event?.id), type: String(event?.type), time: String(event?.time) };
}

function unmoved(row: ViewRow): Advance {
  return { folded: row.folded, lastEvent: row.lastEvent };
}

function advanceOf(row: ViewRow, page: ReadPage, folded: FoldedView): Advance {
  const last = page.events[folded.lastFolded];
  return last === undefined
    ? unmoved(row)
    : {
        view: folded.view,
        folded: row.folded + folded.folded,
        lastEvent: { id: last.event.id, time: last.event.time },
      };
}

function nextAt(advance: Advance, place: Place): Omit<FoldedRow, 'overtimes' | 'phase'> {
  return { ...advance, checkpoint: place.point, checkpointAt: place.at };
}

function triedAgain(row: ViewRow, advance: Advance, place: Place, { page, at, kind, retries }: Try): FoldedRow {
  const overtimes = row.overtimes + 1;
  if (overtimes < retries.overtimesBeforeStall) {
    return { ...nextAt(advance, place), overtimes, phase: row.phase };
  }
  const stopped = kind === 'time' ? `its deadline of ${retries.foldDeadlineMs} ms` : `its ${kind}`;
  const stall = {
    event: stalledEventOf(page, at),
    kind,
    message: `The fold was stopped by ${stopped} ${overtimes} times`,
    line: null,
  };
  return { ...nextAt(advance, place), overtimes, phase: 'stalled', stall };
}

function stalledOf(row: ViewRow, advance: Advance, page: ReadPage, { at, kind, message, line }: FoldStall): FoldedRow {
  const stall = {
    event: stalledEventOf(page, at),
    kind,
    message,
    line: line === null ? null : lineInDocument(row.details, line),
  };
  return { ...nextAt(advance, before(row, page, at)), overtimes: row.overtimes, phase: 'stalled', stall };
}

function endOf(row: ViewRow, folded: FoldedView, { page, early }: FoldedPageOf): Place {
  return laterOf(row, early ? placeOfEvent(page.events[folded.through]) : placeOfStore(page.lastExamined));
}

export function viewChangeOf(row: ViewRow, folded: FoldedView, of: FoldedPageOf): ViewChange {
  const advance = advanceOf(row, of.page, folded);
  if (folded.stall !== undefined) {
    return { row, next: stalledOf(row, advance, of.page, folded.stall) };
  }
  if (folded.overtime !== undefined) {
    const timedOut: Try = { page: of.page, at: folded.overtime, kind: 'time', retries: of.retries };
    return { row, next: triedAgain(row, advance, before(row, of.page, folded.overtime), timedOut) };
  }
  return { row, next: { ...nextAt(advance, endOf(row, folded, of)), overtimes: 0, phase: row.phase } };
}

export function lostTryOf(row: ViewRow, lost: Try): ViewChange {
  return { row, next: triedAgain(row, unmoved(row), placeOfRow(row), lost) };
}

export function salvagedTryOf(row: ViewRow, folded: FoldedView, salvage: FoldedPageOf, lost: Try): ViewChange {
  const advance = advanceOf(row, salvage.page, folded);
  return { row, next: triedAgain(row, advance, endOf(row, folded, salvage), lost) };
}

export function unchangedOf(row: ViewRow): ViewChange {
  const { checkpoint, checkpointAt, lastEvent, folded, overtimes, phase } = row;
  return { row, next: { checkpoint, checkpointAt, lastEvent, folded, overtimes, phase } };
}

export function liveFrom({ row, next }: ViewChange): ViewChange {
  return { row, next: { ...next, phase: 'live' } };
}

export function hasChanged({ row, next }: ViewChange): boolean {
  return (
    next.phase !== row.phase ||
    next.overtimes !== row.overtimes ||
    next.folded !== row.folded ||
    comparePoints(next.checkpoint, row.checkpoint) !== 0
  );
}

export function hasTriedAgain({ row, next }: ViewChange): boolean {
  return next.overtimes > row.overtimes;
}

export function rowAfter({ row, next }: ViewChange): ViewRow {
  return {
    ...Struct.omit(row, ['stall']),
    checkpoint: next.checkpoint,
    checkpointText: pointText(next.checkpoint),
    checkpointAt: next.checkpointAt,
    lastEvent: next.lastEvent,
    folded: next.folded,
    overtimes: next.overtimes,
    phase: next.phase,
    ...(next.stall === undefined ? {} : { stall: next.stall }),
  };
}
