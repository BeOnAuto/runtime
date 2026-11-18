import { chunksOf } from '../connection/bound-values.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import type { ProjectionKeeping } from './projection-keeping.ts';
import { rowsWrite, type KeptRow } from './projection-statements.ts';

export function writtenInChunks(keeping: ProjectionKeeping, execute: StatementExecutor, kept: readonly KeptRow[]) {
  const { dialect, projection } = keeping;
  return inTurn(chunksOf(kept, dialect.rowsInAWrite(projection.columns.length)), (rows) =>
    execute.command(rowsWrite(dialect, projection, rows)),
  );
}
