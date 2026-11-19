import { SQL } from '@event-driven-io/dumbo';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { tableOf } from '../projections/projection-statements.ts';
import { startWritten } from './catch-up-checkpoints.ts';
import { foldsFact } from './catch-up-page.ts';
import { isCatchingUp, type TablesCatchingUp } from './catching-up.ts';

interface StartingAgain {
  readonly keepings: readonly ProjectionKeeping[];
  readonly catchingUp: TablesCatchingUp;
}

export interface ScrubbedFact {
  readonly stream: string;
  readonly type: string;
}

export async function startedAgainBy(
  { keepings, catchingUp }: StartingAgain,
  execute: StatementExecutor,
  scrubbed: ScrubbedFact,
): Promise<readonly ProjectionKeeping[]> {
  const started: ProjectionKeeping[] = [];
  await inTurn(keepings, async (keeping) => {
    const { dialect, projection } = keeping;
    if (foldsFact(projection, scrubbed) && (await isCatchingUp(catchingUp, projection, execute))) {
      await execute.command(SQL`DELETE FROM ${tableOf(projection)}`);
      await execute.command(startWritten(projection, dialect.catchUp.beforeEveryFact));
      started.push(keeping);
    }
  });
  return started;
}
