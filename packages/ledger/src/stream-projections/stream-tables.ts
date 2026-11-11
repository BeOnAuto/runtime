import { checkpointsOf, projectedTableOf, type StreamProjection } from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { versionOfTable, type NamedProjection } from '../projections/projection-fill.ts';
import { createdTable, namesIn, tableDrop } from '../projections/projection-statements.ts';
import { checkpointsCreated, everyRowEmptied } from './stream-statements.ts';

export function tablesOf(projection: StreamProjection): readonly NamedProjection[] {
  return [...projection.tables, checkpointsOf(projection)];
}

export async function prepared(
  { dialect }: { readonly dialect: ProjectionDialect },
  projection: StreamProjection,
  { execute, inTransaction }: { readonly execute: StatementExecutor; readonly inTransaction: InTransaction },
): Promise<void> {
  const versioned = [...projection.tables, checkpointsOf(projection)];
  const found = new Set<string>();
  await inTurn(versioned, async ({ name }) => {
    for (const table of await namesIn(execute, dialect.tableVersions(name))) {
      found.add(table);
    }
  });
  if (versioned.every((table) => found.has(projectedTableOf(table)))) {
    return;
  }
  const earlier = [...found].filter((table) =>
    versioned.some((named) => (versionOfTable(named, table) ?? projection.version) < projection.version),
  );
  await inTransaction((transaction) =>
    inTurn(
      [
        ...projection.tables.flatMap((table) => createdTable(dialect, table)),
        checkpointsCreated(dialect, projection),
        ...everyRowEmptied(projection),
        ...earlier.map((table) => tableDrop(table)),
      ],
      (statement) => transaction.command(statement),
    ),
  );
}
