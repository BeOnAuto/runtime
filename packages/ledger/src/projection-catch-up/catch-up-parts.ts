import type { InTransaction } from '../event-store.ts';
import { tablesMadeAgainLogged } from '../projection-checkpoints/projection-checkpoints.ts';
import type { KeptTables } from '../projections/kept-tables.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { mostBytesInABatch } from '../projections/projection-fill.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { caughtUp, pageFailuresLogged } from './caught-up.ts';
import { reconciled } from './reconciled.ts';

export interface CatchUpParts {
  readonly mostBytes: number;
  readonly reconciled: (inTransaction: InTransaction) => Promise<void>;
  readonly caughtUp: (inTransaction: InTransaction) => Promise<void>;
}

export function catchUpPartsOf(
  dialect: ProjectionDialect,
  keepings: readonly ProjectionKeeping[],
  {
    mostBytesFilledAtOnce = mostBytesInABatch,
    tableMadeAgain = tablesMadeAgainLogged,
    pageFailed = pageFailuresLogged,
  }: KeptTables,
): CatchUpParts {
  return {
    mostBytes: mostBytesFilledAtOnce,
    reconciled: (inTransaction) => reconciled(keepings, inTransaction, tableMadeAgain),
    caughtUp: (inTransaction) =>
      caughtUp({ dialect, keepings, mostBytes: mostBytesFilledAtOnce, failed: pageFailed }, inTransaction),
  };
}
