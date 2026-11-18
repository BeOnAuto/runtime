import { projectedTableOf } from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { TableMadeAgain } from '../projection-checkpoints/projection-checkpoints.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { createdTable, namesIn, tableDrop } from '../projections/projection-statements.ts';
import { checkpointRows, rowOf, startWritten, type CheckpointRow } from './catch-up-checkpoints.ts';

async function keptOrMade(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  rows: readonly CheckpointRow[],
): Promise<readonly string[]> {
  const current = projectedTableOf(projection);
  const present = (await namesIn(execute, dialect.tableVersions(projection.name))).includes(current);
  if (present && rowOf(rows, projection) !== undefined) {
    return [];
  }
  if (present) {
    await execute.command(tableDrop(current));
  }
  await inTurn(createdTable(dialect, projection), (statement) => execute.command(statement));
  await execute.command(startWritten(projection, dialect.catchUp.beforeEveryFact));
  return present ? [current] : [];
}

export async function reconciled(
  keepings: readonly ProjectionKeeping[],
  inTransaction: InTransaction,
  madeAgain: TableMadeAgain,
): Promise<void> {
  if (keepings.length === 0) {
    return;
  }
  const remade = await inTransaction(async (execute) => {
    const rows = await checkpointRows(execute);
    const dropped: string[] = [];
    await inTurn(keepings, async (keeping) => {
      dropped.push(...(await keptOrMade(keeping, execute, rows)));
    });
    return dropped;
  });
  for (const table of remade) {
    madeAgain(table);
  }
}
