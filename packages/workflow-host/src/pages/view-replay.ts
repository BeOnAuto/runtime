import type { StoredPlace } from '@on.auto/ledger';
import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Semaphore, type Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { keptViewOf, ViewRowSchema, viewRowOf, type KeptView, type ViewRow } from '../views/view-rows.ts';
import { viewNamed } from '../views/view-statements.ts';
import { comparePoints } from './history-points.ts';
import { readPage, typesToRead, type ReadPage } from './page-events.ts';
import { consideredBy, foldedOver, type FoldingTurn } from './page-folding.ts';
import { rowAfter } from './view-changes.ts';

export const replayBounds = { pages: 10 } as const;

export type ViewAsOf = Omit<KeptView, 'phase'> & { readonly phase: KeptView['phase'] | 'out_of_reach' };

export interface ViewsAsOf {
  readonly viewAsOfRun: (playbook: PlaybookAddress, name: string, run: string) => Effect.Effect<ViewAsOf | undefined>;
}

interface Replaying {
  readonly pool: FoldingTurn['settings']['pool'];
  readonly folding: FoldingTurn['settings']['folding'];
  readonly pages?: number;
}

interface Replay {
  readonly row: ViewRow;
  readonly view: Schema.Json;
}

interface Going {
  readonly playbookKey: string;
  readonly through: StoredPlace;
  readonly turn: FoldingTurn;
}

function fromTheStart(row: ViewRow): Replay {
  const { stall: _stall, ...fresh } = row;
  return {
    row: {
      ...fresh,
      phase: 'live',
      checkpoint: undefined,
      checkpointText: '',
      checkpointAt: null,
      lastEvent: null,
      folded: 0,
      overtimes: 0,
    },
    view: row.details.initial,
  };
}

function reachesThrough(page: ReadPage, through: StoredPlace): boolean {
  return page.atTheEnd || comparePoints(page.lastExamined?.point, through.point) >= 0;
}

function upTo(page: ReadPage, through: StoredPlace): ReadPage {
  const events = page.events.filter(({ point }) => comparePoints(point, through.point) <= 0);
  return reachesThrough(page, through) ? { ...page, events, lastExamined: through, atTheEnd: true } : page;
}

function ofTheRow(row: ViewRow, { playbookKey }: Going) {
  const types = typesToRead(row.details.filters.map(({ type }) => type));
  return { playbookKey, after: row.checkpoint, types, definitionTypes: [] };
}

function replayedBy(database: HostDatabase, going: Going) {
  const pageOn = ({ row, view }: Replay, pages: number): Effect.Effect<KeptView | 'out_of_reach'> =>
    Effect.gen(function* () {
      if (pages === 0) {
        return 'out_of_reach';
      }
      const read = yield* Effect.promise(() => readPage(database.store, ofTheRow(row, going)));
      const page = upTo(read, going.through);
      const events = consideredBy(row, page);
      const result = yield* foldedOver([{ row, view, events }], page, going.turn);
      if (result.again) {
        return 'out_of_reach';
      }
      const reached = result.changes.reduce<Replay>(
        (at, change) => ({ row: rowAfter(change), view: change.next.view ?? at.view }),
        { row, view },
      );
      const atTheRun = result.complete && page.atTheEnd;
      return reached.row.phase === 'stalled' || atTheRun
        ? keptViewOf(reached.row, reached.view)
        : yield* pageOn(reached, pages - 1);
    });
  return pageOn;
}

function outOfReach({ name, version, details }: ViewRow): ViewAsOf {
  return {
    name,
    version,
    phase: 'out_of_reach',
    view: details.initial,
    checkpoint: null,
    checkpointAt: null,
    lastEvent: null,
    folded: 0,
  };
}

function rowNamed(database: HostDatabase, playbookKey: string, name: string) {
  return rowsOf(ViewRowSchema, database.read(viewNamed(playbookKey, name))).pipe(
    Effect.map(([row]) => (row === undefined ? undefined : viewRowOf(row))),
  );
}

function lastPlaceOfRun(
  database: HostDatabase,
  playbookKey: string,
  run: string,
): Effect.Effect<StoredPlace | undefined> {
  return Effect.promise(() =>
    database.store.readRecorded(playbookKey, { kind: 'run', run }, { order: 'desc', limit: 1 }),
  ).pipe(Effect.map(({ records: [last] }) => last));
}

function replayed(
  database: HostDatabase,
  going: Omit<Going, 'through'>,
  { pages = replayBounds.pages }: Pick<Replaying, 'pages'>,
) {
  return Effect.fnUntraced(function* (
    name: string,
    run: string,
  ): Effect.fn.Return<ViewAsOf | undefined, DatabaseFailed> {
    const row = yield* rowNamed(database, going.playbookKey, name);
    const through = yield* lastPlaceOfRun(database, going.playbookKey, run);
    if (row === undefined || through === undefined) {
      return undefined;
    }
    const reached = yield* replayedBy(database, { ...going, through })(fromTheStart(row), pages);
    return reached === 'out_of_reach' ? outOfReach(row) : reached;
  });
}

export function viewsAsOfOn(database: HostDatabase, replaying: Replaying): ViewsAsOf {
  const { pool, folding } = replaying;
  const turn: FoldingTurn = {
    settings: { pool, folding, overtimesBeforeStall: 1 },
    share: Semaphore.makeUnsafe(1),
  };
  return {
    viewAsOfRun: (playbook, name, run) =>
      Effect.orDie(replayed(database, { playbookKey: streamPrefixOfPlaybook(playbook), turn }, replaying)(name, run)),
  };
}
