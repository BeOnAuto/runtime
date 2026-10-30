import type { PageFilters } from '@on.auto/workflow-engine';
import {
  comparePoints,
  isAfter,
  type DatabaseFailed,
  type FoldedChanges,
  type HostDatabase,
  type PageEvent,
  type ReadPage,
} from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { periodForm, periodOfForm } from '../periods/grains.ts';
import { datasetMatchingOf, type MatchedEvent } from './dataset-matching.ts';
import { mergedRows, type MergedRow } from './dataset-merging.ts';
import { standingOf, type DatasetRow, type DatasetStanding } from './dataset-rows.ts';
import { eventReadingOf, type Contribution, type EventReading } from './event-values.ts';

interface PassedOverEvent {
  readonly record: string;
  readonly detail: string;
}

export interface DatasetChange {
  readonly row: DatasetRow;
  readonly next: DatasetStanding;
  readonly upserts: readonly MergedRow[];
  readonly passedOver: readonly PassedOverEvent[];
}

interface Stop {
  readonly placed: PageEvent;
  readonly detail: string;
}

interface Read {
  readonly contributions: readonly Contribution[];
  readonly passedOver: readonly PassedOverEvent[];
  readonly stop: Stop | undefined;
  readonly lastRead: PageEvent | undefined;
}

function readingOf(row: DatasetRow, { placed, match }: MatchedEvent): EventReading | undefined {
  if (match.kind === 'refused') {
    return { refusal: match.detail };
  }
  return match.kind === 'taken' ? eventReadingOf(row.data, placed) : undefined;
}

function readWith(row: DatasetRow, matched: readonly MatchedEvent[]): Read {
  const contributions: Contribution[] = [];
  const passedOver: PassedOverEvent[] = [];
  let lastRead: PageEvent | undefined;
  for (const event of matched) {
    const { placed, match } = event;
    if (match.kind === 'stopped') {
      return { contributions, passedOver, stop: { placed, detail: match.detail }, lastRead };
    }
    const reading = readingOf(row, event);
    if (reading !== undefined && 'refusal' in reading) {
      passedOver.push({ record: placed.record, detail: reading.refusal });
    } else if (reading !== undefined) {
      contributions.push(reading.contribution);
    }
    lastRead = placed;
  }
  return { contributions, passedOver, stop: undefined, lastRead };
}

function readFrom(row: DatasetRow, events: readonly PageEvent[], filters: PageFilters): Effect.Effect<Read> {
  return Effect.map(datasetMatchingOf(row.data, filters).matchesOf(events), (matched) => readWith(row, matched));
}

function reachedOf(page: ReadPage, { stop, lastRead }: Read): ReadPage['lastExamined'] {
  if (stop === undefined) {
    return page.lastExamined;
  }
  return lastRead === undefined ? undefined : { point: lastRead.point, recordedAt: lastRead.recordedAt };
}

function checkpointOf(
  row: DatasetRow,
  page: ReadPage,
  read: Read,
): Pick<DatasetStanding, 'checkpoint' | 'checkpointAt'> {
  const reached = reachedOf(page, read);
  return reached !== undefined && comparePoints(reached.point, row.checkpoint) > 0
    ? { checkpoint: reached.point, checkpointAt: reached.recordedAt }
    : { checkpoint: row.checkpoint, checkpointAt: row.checkpointAt };
}

function periodsOf(
  row: DatasetRow,
  upserts: readonly MergedRow[],
): Pick<DatasetStanding, 'firstPeriod' | 'lastPeriod'> {
  const grain = row.data.period;
  const known = [row.firstPeriod, row.lastPeriod].flatMap((form) =>
    form === null ? [] : [Number(periodOfForm(grain, form))],
  );
  const periods = [...known, ...upserts.map(({ period }) => period)];
  return periods.length === 0
    ? { firstPeriod: row.firstPeriod, lastPeriod: row.lastPeriod }
    : { firstPeriod: periodForm(grain, Math.min(...periods)), lastPeriod: periodForm(grain, Math.max(...periods)) };
}

interface Folding {
  readonly filters: PageFilters;
  readonly triesBeforeStall: number;
}

function triedOf(
  row: DatasetRow,
  { stop }: Read,
  { triesBeforeStall }: Folding,
): Pick<DatasetStanding, 'phase' | 'tries' | 'stall'> {
  if (stop === undefined) {
    return { phase: row.phase, tries: 0, stall: null };
  }
  const tries = row.tries + 1;
  if (tries < triesBeforeStall) {
    return { phase: row.phase, tries, stall: null };
  }
  const detail = `Its data test was stopped ${tries} times without a page folded whole, the last at this event, by a limit of time or memory, which no event causes: ${stop.detail}`;
  return { phase: 'stalled', tries, stall: { record: stop.placed.record, detail } };
}

function changeOf(row: DatasetRow, page: ReadPage, database: HostDatabase, folding: Folding) {
  const considered = new Set(row.data.events.map(({ type }) => type));
  const events = page.events.filter(({ point, event }) => isAfter(point, row.checkpoint) && considered.has(event.type));
  return Effect.gen(function* () {
    const read = yield* readFrom(row, events, folding.filters);
    const merged = yield* mergedRows(database, row, read.contributions);
    const next: DatasetStanding = {
      ...standingOf(row),
      ...checkpointOf(row, page, read),
      ...periodsOf(row, merged.rows),
      ...triedOf(row, read, folding),
      rows: row.rows + merged.newRows,
      series: row.series + merged.newSeries,
      eventsFolded: row.eventsFolded + read.contributions.length,
      passedOver: row.passedOver + read.passedOver.length,
    };
    const change: DatasetChange = { row, next, upserts: merged.rows, passedOver: read.passedOver };
    return { change, cut: read.stop !== undefined };
  });
}

export function hasDatasetChanged({ row, next }: DatasetChange): boolean {
  return (
    next.phase !== row.phase ||
    next.eventsFolded !== row.eventsFolded ||
    next.passedOver !== row.passedOver ||
    next.tries !== row.tries ||
    comparePoints(next.checkpoint, row.checkpoint) !== 0
  );
}

export function foldedDatasets(
  rows: readonly DatasetRow[],
  page: ReadPage,
  database: HostDatabase,
  folding: Folding,
): Effect.Effect<FoldedChanges<DatasetChange>, DatabaseFailed> {
  return Effect.map(
    Effect.forEach(rows, (row) => changeOf(row, page, database, folding)),
    (folded: readonly { readonly change: DatasetChange; readonly cut: boolean }[]) => ({
      changes: folded.map(({ change }) => change).filter((change) => hasDatasetChanged(change)),
      resting: folded.filter(({ cut }) => cut).map(({ change }) => change.row.dataSha256),
      complete: !folded.some(({ cut }) => cut),
      again: false,
    }),
  );
}
