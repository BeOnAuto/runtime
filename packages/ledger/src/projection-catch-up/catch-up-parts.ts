import type { CatchUpState, InTransaction, StatementExecutor } from '../event-store.ts';
import { tablesMadeAgainLogged } from '../projection-checkpoints/projection-checkpoints.ts';
import type { KeptTables } from '../projections/kept-tables.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { mostBytesInABatch } from '../projections/projection-fill.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { tablesCatchingUp, type TablesCatchingUp } from './catching-up.ts';
import { caughtUp, pageFailuresLogged } from './caught-up.ts';
import { reconciled } from './reconciled.ts';
import { startedAgainBy, type ScrubbedFact } from './started-again.ts';

export interface CatchUpParts {
  readonly mostBytes: number;
  readonly catchingUp: TablesCatchingUp;
  readonly reconciled: (inTransaction: InTransaction) => Promise<void>;
  readonly caughtUp: (inTransaction: InTransaction) => Promise<CatchUpState>;
  readonly startedAgain: (execute: StatementExecutor, scrubbed: ScrubbedFact) => Promise<readonly ProjectionKeeping[]>;
}

export function catchUpPartsOf(
  dialect: ProjectionDialect,
  keepings: readonly ProjectionKeeping[],
  {
    mostBytesFilledAtOnce = mostBytesInABatch,
    tableMadeAgain = tablesMadeAgainLogged,
    pageFailed = pageFailuresLogged,
    catchUpBudget,
  }: KeptTables,
): CatchUpParts {
  const catchingUp = tablesCatchingUp();
  const catching = { dialect, keepings, mostBytes: mostBytesFilledAtOnce, failed: pageFailed };
  return {
    mostBytes: mostBytesFilledAtOnce,
    catchingUp,
    reconciled: (inTransaction) => reconciled(keepings, inTransaction, tableMadeAgain),
    caughtUp: async (inTransaction) => {
      const behind = await caughtUp(catching, inTransaction, catchUpBudget);
      catchingUp.answeredBy(behind.map(({ projection }) => projection));
      return behind.length === 0 ? 'caught_up' : 'catching_up';
    },
    startedAgain: (execute, scrubbed) => startedAgainBy({ keepings, catchingUp }, execute, scrubbed),
  };
}
