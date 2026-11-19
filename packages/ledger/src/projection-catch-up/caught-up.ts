import { Context, Effect } from 'effect';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { earlierVersionsForgotten } from '../projection-checkpoints/projection-checkpoints.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { versionOfTable } from '../projections/projection-fill.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { namesIn, tableAnalysis, tableDrop } from '../projections/projection-statements.ts';
import { checkpointRows } from './catch-up-checkpoints.ts';
import { behindOf, pageCaughtUp, type CatchingUp, type Page, type PageDone, type PageFailed } from './catch-up-page.ts';

export interface CatchUpBudget {
  readonly pages: number;
}

export function pageFailuresLoggedWith(context: Context.Context<never>): PageFailed {
  return (position) => {
    Effect.runForkWith(context)(
      Effect.logError(
        'A page of the catch-up of the keyed projections failed and rolled back; the catch-up takes the page again from the same position',
      ).pipe(Effect.annotateLogs({ position })),
    );
  };
}

export const pageFailuresLogged: PageFailed = pageFailuresLoggedWith(Context.empty());

function isEarlier({ projection }: ProjectionKeeping, table: string): boolean {
  const version = versionOfTable(projection, table);
  return version !== undefined && version < projection.version;
}

async function earlierDropped(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  filled: readonly ProjectionKeeping[],
): Promise<void> {
  const { dialect, projection } = keeping;
  const tables = await namesIn(execute, dialect.tableVersions(projection.name));
  const earlier = tables.filter((table) => isEarlier(keeping, table));
  if (earlier.length === 0 && !filled.includes(keeping)) {
    return;
  }
  await inTurn(earlier, (table) => execute.command(tableDrop(table)));
  await execute.command(earlierVersionsForgotten(projection));
  await execute.command(tableAnalysis(projection));
}

function pageIn(catching: CatchingUp, inTransaction: InTransaction, page: Page) {
  return Effect.tryPromise({
    try: () => inTransaction((execute) => pageCaughtUp(catching, execute, page)),
    catch: (failure) => failure,
  });
}

interface SliceEnded {
  readonly whole: boolean;
  readonly finished: readonly ProjectionKeeping[];
}

function pagesOf(catching: CatchingUp, inTransaction: InTransaction, spent: () => boolean) {
  return Effect.gen(function* () {
    const finished: ProjectionKeeping[] = [];
    let page: Page | undefined = { listing: 1 };
    let whole = false;
    while (page !== undefined) {
      const done: PageDone = yield* pageIn(catching, inTransaction, page);
      finished.push(...done.caughtUp);
      whole = done.next === undefined;
      page = spent() ? undefined : done.next;
    }
    const ended: SliceEnded = { whole, finished };
    return ended;
  });
}

function spentAfter({ pages }: CatchUpBudget): () => boolean {
  const ran = { pages: 0 };
  return () => {
    ran.pages += 1;
    return ran.pages >= pages;
  };
}

function budgetedPagesOf(catching: CatchingUp, inTransaction: InTransaction, budget: CatchUpBudget) {
  const failed = { logged: false };
  const logging: CatchingUp = {
    ...catching,
    failed: (position) => {
      failed.logged = true;
      catching.failed(position);
    },
  };
  const stopped: SliceEnded = { whole: false, finished: [] };
  return pagesOf(logging, inTransaction, spentAfter(budget)).pipe(
    Effect.catch((failure) => (failed.logged ? Effect.succeed(stopped) : Effect.fail(failure))),
  );
}

async function stillBehind(
  catching: CatchingUp,
  inTransaction: InTransaction,
  { whole }: SliceEnded,
): Promise<readonly ProjectionKeeping[]> {
  if (whole) {
    return [];
  }
  const rows = await inTransaction((execute) => checkpointRows(execute));
  return behindOf(catching.keepings, rows).map(({ keeping }) => keeping);
}

export async function caughtUp(
  catching: CatchingUp,
  inTransaction: InTransaction,
  budget: CatchUpBudget | undefined,
): Promise<readonly ProjectionKeeping[]> {
  if (catching.keepings.length === 0) {
    return [];
  }
  const slice =
    budget === undefined
      ? pagesOf(catching, inTransaction, () => false)
      : budgetedPagesOf(catching, inTransaction, budget);
  const ended = await Effect.runPromise(slice);
  const behind = await stillBehind(catching, inTransaction, ended);
  if (behind.length === 0) {
    await inTransaction((execute) =>
      inTurn(catching.keepings, (keeping) => earlierDropped(keeping, execute, ended.finished)),
    );
  }
  return behind;
}
