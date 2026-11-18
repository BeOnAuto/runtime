import { Context, Effect } from 'effect';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { earlierVersionsForgotten } from '../projection-checkpoints/projection-checkpoints.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { versionOfTable } from '../projections/projection-fill.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { namesIn, tableAnalysis, tableDrop } from '../projections/projection-statements.ts';
import { pageCaughtUp, type CatchingUp, type Page, type PageDone, type PageFailed } from './catch-up-page.ts';

export function pageFailuresLoggedWith(context: Context.Context<never>): PageFailed {
  return (position) => {
    Effect.runForkWith(context)(
      Effect.logError(
        'A page of the catch-up of the keyed projections failed, so the ledger did not open; the next opening takes the page again from the same position',
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

export async function caughtUp(catching: CatchingUp, inTransaction: InTransaction): Promise<void> {
  if (catching.keepings.length === 0) {
    return;
  }
  const filled = await Effect.runPromise(
    Effect.gen(function* () {
      const caughtUpNow: ProjectionKeeping[] = [];
      let page: Page | undefined = { listing: 1 };
      while (page !== undefined) {
        const done: PageDone = yield* pageIn(catching, inTransaction, page);
        caughtUpNow.push(...done.caughtUp);
        page = done.next;
      }
      return caughtUpNow;
    }),
  );
  await inTransaction((execute) => inTurn(catching.keepings, (keeping) => earlierDropped(keeping, execute, filled)));
}
