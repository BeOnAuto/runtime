import type { KeyedProjection, ProjectionAdvancer, ProjectionReader, RunOutcomeMapping } from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { CarriedTables } from '../layout/layout-steps.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import { factScrubsOf, type FactScrubs } from '../scrub/fact-scrubs.ts';
import type { InlineRegistration } from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { preparedProjections } from './projection-fill.ts';
import { projectionRegistrations, type ProjectionKeeping } from './projection-keeping.ts';
import { projectionReader, type ProjectionStatements } from './projection-reads.ts';

export interface KeptTables extends CarriedTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeyedProjection[] | undefined;
}

export interface ProjectionParts {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeyedProjection[];
  readonly keepings: readonly ProjectionKeeping[];
  readonly scrubs: FactScrubs;
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly readerOn: (statements: ProjectionStatements) => ProjectionReader & ProjectionAdvancer;
}

export function projectionPartsOf(
  dialect: ProjectionDialect,
  { runOutcomes, projections = [] }: KeptTables,
): ProjectionParts {
  const kept = keptProjections(runOutcomes, projections);
  const keepings = kept.map((projection) => ({ dialect, projection }));
  return {
    dialect,
    projections: kept,
    keepings,
    scrubs: factScrubsOf(dialect, keepings),
    registrations: projectionRegistrations(dialect, kept),
    prepare: (execute, inTransaction) => preparedProjections(keepings, execute, inTransaction),
    readerOn: (statements) => projectionReader(dialect, kept, statements),
  };
}
