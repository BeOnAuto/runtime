import {
  pooledJob,
  type FoldedView,
  type FoldingView,
  type FoldOutcome,
  type FoldRequest,
} from '@on.auto/workflow-engine/dsl';
import { Array, Effect, type Schema, type Semaphore } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { FoldedViewSchema, type StallCause, type ViewRow } from '../views/view-rows.ts';
import { viewToFold } from '../views/view-statements.ts';
import { pageDeadlineMs, waitForAWorkerMs, type ViewsFolding } from '../views/views-folding.ts';
import { isAfter } from './history-points.ts';
import type { PageEvent, ReadPage } from './page-events.ts';
import {
  hasChanged,
  lostTryOf,
  salvagedTryOf,
  viewChangeOf,
  type Retries,
  type Try,
  type ViewChange,
} from './view-changes.ts';

export interface FoldedPageResult {
  readonly changes: readonly ViewChange[];
  readonly complete: boolean;
  readonly again: boolean;
  readonly trouble?: string;
}

export interface PageFolding {
  readonly settings: ViewsFolding;
  readonly share: Semaphore.Semaphore;
  readonly database: HostDatabase;
}

interface Folding {
  readonly row: ViewRow;
  readonly view: Schema.Json;
  readonly events: readonly number[];
}

type Lost = Extract<FoldOutcome, { readonly ran: 'stopped' | 'crashed' }>;

type Folded = Extract<FoldOutcome, { readonly ran: 'folded' }>;

const runSourcePrefix = '/runs/';

const stoppedBy = { deadline: 'time', memory: 'memory' } as const satisfies Readonly<Record<string, StallCause>>;

function isOwnRun({ event }: PageEvent, ownSubject: string): boolean {
  return event.source.startsWith(runSourcePrefix) && event.subject === ownSubject;
}

function consideredBy(row: ViewRow, page: ReadPage, definitionType: string): readonly number[] {
  const types = new Set(row.details.filters.map(({ type }) => type));
  const ownSubject = `${definitionType}/${row.name}`;
  return page.events.flatMap((placed, index) =>
    isAfter(placed.point, row.checkpoint) && types.has(placed.event.type) && !isOwnRun(placed, ownSubject)
      ? [index]
      : [],
  );
}

function foldingViewOf({ row, view, events }: Folding): FoldingView {
  const { details } = row;
  return {
    fold: details.fold,
    filters: details.filters,
    view,
    ...(details.schema === undefined ? {} : { schema: details.schema }),
    events,
  };
}

function requestOf(foldings: readonly Folding[], page: ReadPage, { folding }: ViewsFolding): FoldRequest {
  return {
    ...folding,
    events: page.events.map(({ event }) => event),
    views: foldings.map((each) => foldingViewOf(each)),
    waitMs: waitForAWorkerMs,
    deadlineMs: pageDeadlineMs(folding),
  };
}

function retriesOf({ overtimesBeforeStall, folding }: ViewsFolding): Retries {
  return { overtimesBeforeStall, foldDeadlineMs: folding.foldDeadlineMs };
}

function causeOf(outcome: Lost): StallCause | undefined {
  if (outcome.ran === 'crashed') {
    return 'crash';
  }
  return outcome.because === 'deadline' || outcome.because === 'memory' ? stoppedBy[outcome.because] : undefined;
}

const unreadable: FoldedPageResult = {
  changes: [],
  complete: false,
  again: true,
  trouble: 'A worker answered a page of folds with something it could not read',
};

function troubleOf(outcome: Lost, kind: StallCause | undefined) {
  if (outcome.ran === 'crashed') {
    return { trouble: `A page of folds crashed before it named a fold: ${outcome.detail}` };
  }
  return kind === undefined
    ? {}
    : { trouble: `A page of folds was stopped by its ${outcome.because} before it named a fold` };
}

function foldedChanges(foldings: readonly Folding[], page: ReadPage, outcome: Folded, retries: Retries) {
  return Array.zip(foldings, outcome.views).map(([{ row }, folded]: readonly [Folding, FoldedView]) =>
    viewChangeOf(row, folded, { page, early: outcome.early, retries }),
  );
}

function foldedBy(request: FoldRequest, { settings, share }: PageFolding): Effect.Effect<FoldOutcome> {
  return share.withPermits(1)(pooledJob('fold', (signal) => settings.pool.fold(request, signal)));
}

function salvageOf(page: ReadPage, at: number): ReadPage {
  const events = page.events.slice(0, at);
  const last = events.at(-1);
  return {
    ...page,
    events,
    lastExamined: last === undefined ? undefined : { point: last.point, recordedAt: last.recordedAt },
    atTheEnd: false,
  };
}

function salvagedTry(going: Folding, lost: Try, parts: PageFolding): Effect.Effect<ViewChange> {
  const page = salvageOf(lost.page, lost.at);
  const salvaging = { ...going, events: going.events.filter((index) => index < lost.at) };
  if (salvaging.events.length === 0) {
    return Effect.succeed(lostTryOf(going.row, lost));
  }
  return foldedBy(requestOf([salvaging], page, parts.settings), parts).pipe(
    Effect.map((outcome) => {
      const [salvaged] = outcome.ran === 'folded' ? outcome.views : [];
      return salvaged === undefined || salvaged.stall !== undefined || salvaged.overtime !== undefined
        ? lostTryOf(going.row, lost)
        : salvagedTryOf(
            going.row,
            salvaged,
            { page, early: outcome.ran === 'folded' && outcome.early, retries: lost.retries },
            lost,
          );
    }),
  );
}

function lostChanges(foldings: readonly Folding[], page: ReadPage, outcome: Lost, parts: PageFolding) {
  const kind = causeOf(outcome);
  const progress = 'progress' in outcome ? outcome.progress : undefined;
  const going = progress === undefined ? undefined : foldings[progress.view];
  if (progress === undefined || going === undefined || kind === undefined) {
    return Effect.succeed<FoldedPageResult>({ changes: [], complete: false, again: true, ...troubleOf(outcome, kind) });
  }
  const lost: Try = { page, at: progress.event, kind, retries: retriesOf(parts.settings) };
  return salvagedTry(going, lost, parts).pipe(
    Effect.map((change): FoldedPageResult => ({ changes: [change], complete: false, again: false })),
  );
}

function settledBy(
  foldings: readonly Folding[],
  page: ReadPage,
  outcome: FoldOutcome,
  parts: PageFolding,
): Effect.Effect<FoldedPageResult> {
  if (outcome.ran === 'folded') {
    const changes = foldedChanges(foldings, page, outcome, retriesOf(parts.settings));
    return Effect.succeed({
      changes: changes.filter((change) => hasChanged(change)),
      complete: !outcome.early,
      again: false,
    });
  }
  return outcome.ran === 'unreadable' ? Effect.succeed(unreadable) : lostChanges(foldings, page, outcome, parts);
}

function loaded(row: ViewRow, events: readonly number[], database: HostDatabase) {
  if (events.length === 0) {
    return Effect.succeed<readonly Folding[]>([{ row, view: null, events }]);
  }
  return rowsOf(FoldedViewSchema, database.read(viewToFold(row))).pipe(
    Effect.map((found) => found.map(({ view }): Folding => ({ row, view, events }))),
  );
}

function foldingsOf(rows: readonly ViewRow[], page: ReadPage, parts: PageFolding) {
  return Effect.forEach(rows, (row) =>
    loaded(row, consideredBy(row, page, parts.settings.definitionType), parts.database),
  ).pipe(Effect.map((each: readonly (readonly Folding[])[]) => each.flat()));
}

export function foldedPage(
  rows: readonly ViewRow[],
  page: ReadPage,
  parts: PageFolding,
): Effect.Effect<FoldedPageResult, DatabaseFailed> {
  return Effect.gen(function* () {
    const foldings = yield* foldingsOf(rows, page, parts);
    if (foldings.every(({ events }) => events.length === 0)) {
      const views = foldings.map(() => ({ view: null, folded: 0, lastFolded: -1, through: -1, work: 0 }));
      return yield* settledBy(foldings, page, { ran: 'folded', early: false, views, milliseconds: 0 }, parts);
    }
    const outcome = yield* foldedBy(requestOf(foldings, page, parts.settings), parts);
    return yield* settledBy(foldings, page, outcome, parts);
  });
}
