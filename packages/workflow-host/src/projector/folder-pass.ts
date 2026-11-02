import { Effect } from 'effect';

import type { DatabaseFailed } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import { comparePoints, earliestOf, type Point } from '../pages/history-points.ts';
import { readPage, typesToRead, type ReadPage } from '../pages/page-events.ts';
import type { FoldedChanges, Folder, PassedChange, PassedRow } from './folder.ts';
import { hasFreeSlot, reconciledRows, type DefinitionsKept } from './reconciled-rows.ts';

export interface Resting {
  readonly isResting: (playbook: string, row: string) => boolean;
  readonly rest: (playbook: string, row: string) => void;
}

export interface FolderParts extends DefinitionsKept {
  readonly note: (note: HostNote) => Effect.Effect<void>;
  readonly resting: Resting;
  readonly firstSeen: (record: string) => boolean;
  readonly trouble: (what: string) => Effect.Effect<void>;
  readonly definitionTypes: readonly string[];
}

export interface LiveRead {
  readonly after: Point | undefined;
  readonly types: readonly string[];
}

export interface FolderPass {
  readonly live: () => LiveRead | undefined;
  readonly foldShared: (page: ReadPage) => Effect.Effect<void, DatabaseFailed>;
  readonly rebuild: (pages: number) => Effect.Effect<number, DatabaseFailed>;
  readonly again: () => boolean;
  readonly canBuild: () => boolean;
}

interface Pass<Row> {
  readonly rows: readonly Row[];
  readonly pages: number;
}

interface Step<Row> {
  readonly pass: Pass<Row>;
  readonly done: boolean;
  readonly again: boolean;
}

interface Passing<Row extends PassedRow, Change extends PassedChange<Row>> {
  readonly folder: Folder<Row, Change>;
  readonly parts: FolderParts;
  readonly playbook: string;
}

function noted(parts: FolderParts, playbook: string, page: ReadPage): Effect.Effect<void> {
  return Effect.forEach(
    page.passedOver.filter(({ record }) => parts.firstSeen(record)),
    ({ record, reason }) => parts.note({ kind: 'record_passed_over', playbook, record, reason }),
    { discard: true },
  );
}

export function readFor(parts: FolderParts, playbook: string, { after, types }: LiveRead): Effect.Effect<ReadPage> {
  const read = { playbookKey: playbook, after, types: typesToRead(types), definitionTypes: parts.definitionTypes };
  return Effect.promise(() => readPage(parts.database.store, read)).pipe(
    Effect.tap((page) => noted(parts, playbook, page)),
  );
}

function restingKeyOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  { folder }: Passing<Row, Change>,
  key: string,
): string {
  return JSON.stringify([folder.definitionType, key]);
}

function isAwake<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  row: Row,
): boolean {
  return !passing.parts.resting.isResting(passing.playbook, restingKeyOf(passing, passing.folder.keyOf(row)));
}

function isLive({ phase }: PassedRow): boolean {
  return phase === 'live';
}

function liveOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  rows: readonly Row[],
): LiveRead | undefined {
  const live = rows.filter((row) => isLive(row) && isAwake(passing, row));
  return live.length === 0
    ? undefined
    : {
        after: earliestOf(live.map(({ checkpoint }) => checkpoint)),
        types: live.flatMap((row) => passing.folder.typesOf(row)),
      };
}

function troubled<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  result: FoldedChanges<Change>,
): Effect.Effect<void> {
  for (const key of result.resting) {
    passing.parts.resting.rest(passing.playbook, restingKeyOf(passing, key));
  }
  return result.trouble === undefined ? Effect.void : passing.parts.trouble(result.trouble);
}

function applied<Row extends PassedRow, Change extends PassedChange<Row>>(
  { folder, parts, playbook }: Passing<Row, Change>,
  pass: Pass<Row>,
  changes: readonly Change[],
): Effect.Effect<Pass<Row>, DatabaseFailed> {
  const writing = { database: parts.database, playbook, note: parts.note };
  return Effect.forEach(changes, (change) =>
    Effect.map(folder.write(writing, change), (after) => ({ key: folder.keyOf(change.row), after })),
  ).pipe(
    Effect.map((written: readonly { readonly key: string; readonly after: Row | undefined }[]) => {
      const after = new Map(written.map(({ key, after: row }) => [key, row]));
      const rows = pass.rows.flatMap((row) => {
        const key = folder.keyOf(row);
        const kept = after.has(key) ? after.get(key) : row;
        return kept === undefined ? [] : [kept];
      });
      return { rows, pages: pass.pages };
    }),
  );
}

function caughtUp<Row extends PassedRow, Change extends PassedChange<Row>>(
  { folder }: Passing<Row, Change>,
  change: Change,
  rows: readonly Row[],
  atTheEnd: boolean,
): boolean {
  const key = folder.keyOf(change.row);
  const live = rows.filter((other) => folder.keyOf(other) !== key && isLive(other));
  return live.length === 0
    ? atTheEnd
    : atTheEnd || comparePoints(change.next.checkpoint, earliestOf(live.map(({ checkpoint }) => checkpoint))) >= 0;
}

function joining<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  change: Change,
  rows: readonly Row[],
  atTheEnd: boolean,
): Change {
  return change.next.phase === 'rebuilding' && caughtUp(passing, change, rows, atTheEnd)
    ? passing.folder.joinedLive(change)
    : change;
}

function rebuildStep<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  pass: Pass<Row>,
  row: Row,
): Effect.Effect<Step<Row>, DatabaseFailed> {
  const { folder, parts, playbook } = passing;
  return Effect.gen(function* () {
    const page = yield* readFor(parts, playbook, { after: row.checkpoint, types: folder.typesOf(row) });
    const result = yield* folder.fold([row], page, parts.database);
    yield* troubled(passing, result);
    const change = result.changes[0] ?? folder.unchanged(row);
    const settled = result.again ? change : joining(passing, change, pass.rows, result.complete && page.atTheEnd);
    const moved = folder.hasChanged(settled) ? [settled] : [];
    const after = yield* applied(passing, { rows: pass.rows, pages: pass.pages - 1 }, moved);
    const now = after.rows.find((each) => folder.keyOf(each) === folder.keyOf(row));
    const goingOn = now?.phase === 'rebuilding' && isAwake(passing, now);
    return { pass: after, done: result.again || !goingOn, again: result.again };
  });
}

function stepped<Row>(
  start: Pass<Row>,
  step: (pass: Pass<Row>) => Effect.Effect<Step<Row>, DatabaseFailed>,
): Effect.Effect<Step<Row>, DatabaseFailed> {
  const going = (reached: Step<Row>): Effect.Effect<Step<Row>, DatabaseFailed> =>
    reached.done ? Effect.succeed(reached) : Effect.flatMap(step(reached.pass), going);
  return going({ pass: start, done: false, again: false });
}

function rebuilt<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  start: Pass<Row>,
  again: boolean,
): Effect.Effect<Step<Row>, DatabaseFailed> {
  const { folder } = passing;
  const rebuilding = start.rows.filter((row) => row.phase === 'rebuilding' && isAwake(passing, row));
  return Effect.reduce(
    rebuilding,
    (): Step<Row> => ({ pass: start, done: false, again }),
    (reached: Step<Row>, row: Row) =>
      reached.again || reached.pass.pages === 0
        ? Effect.succeed(reached)
        : stepped(reached.pass, (pass) => {
            const current = pass.rows.find((each) => folder.keyOf(each) === folder.keyOf(row));
            return current === undefined || pass.pages === 0
              ? Effect.succeed({ pass, done: true, again: false })
              : rebuildStep(passing, pass, current);
          }),
  );
}

function canBuildFrom<Row extends PassedRow, Change extends PassedChange<Row>>(
  passing: Passing<Row, Change>,
  rows: readonly Row[],
): boolean {
  return (
    hasFreeSlot(rows, passing.folder.rebuildsAtOnce) ||
    rows.some((row) => row.phase === 'rebuilding' && isAwake(passing, row))
  );
}

export function folderPassOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  parts: FolderParts,
  playbook: string,
): Effect.Effect<FolderPass, DatabaseFailed> {
  const passing: Passing<Row, Change> = { folder, parts, playbook };
  return Effect.map(reconciledRows(folder, parts, playbook), (reconciled) => {
    const state = { rows: reconciled, sharing: true, again: false };
    return {
      live: () => (state.sharing ? liveOf(passing, state.rows) : undefined),
      foldShared: (page) =>
        Effect.gen(function* () {
          const result = yield* folder.fold(
            state.rows.filter((row) => isLive(row) && isAwake(passing, row)),
            page,
            parts.database,
          );
          yield* troubled(passing, result);
          const after = yield* applied(passing, { rows: state.rows, pages: 0 }, result.changes);
          state.rows = page.definitionsSeen.has(folder.definitionType)
            ? yield* reconciledRows(folder, parts, playbook)
            : after.rows;
          state.sharing = !(result.again || (result.complete && page.atTheEnd));
          state.again = result.again;
        }),
      rebuild: (pages) =>
        Effect.map(rebuilt(passing, { rows: state.rows, pages }, state.again), (done) => {
          state.rows = done.pass.rows;
          state.again = done.again;
          return done.pass.pages;
        }),
      again: () => state.again,
      canBuild: () => canBuildFrom(passing, state.rows),
    };
  });
}
