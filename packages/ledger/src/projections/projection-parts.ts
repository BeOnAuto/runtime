import type { KeyedProjection, ProjectionAdvancer, ProjectionReader, RunOutcomeMapping } from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import type { InlineRegistration } from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { preparedProjections } from './projection-fill.ts';
import { projectionRegistrations } from './projection-keeping.ts';
import { projectionReader, type ProjectionStatements } from './projection-reads.ts';

export interface KeptTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeyedProjection[] | undefined;
}

export interface ProjectionParts {
  readonly projections: readonly KeyedProjection[];
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly readerOn: (statements: ProjectionStatements) => ProjectionReader & ProjectionAdvancer;
}

export function projectionPartsOf(
  dialect: ProjectionDialect,
  { runOutcomes, projections = [] }: KeptTables,
): ProjectionParts {
  const kept = keptProjections(runOutcomes, projections);
  return {
    projections: kept,
    registrations: projectionRegistrations(dialect, kept),
    prepare: (execute, inTransaction) =>
      preparedProjections(
        kept.map((projection) => ({ dialect, projection })),
        execute,
        inTransaction,
      ),
    readerOn: (statements) => projectionReader(dialect, kept, statements),
  };
}
