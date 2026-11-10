import type {
  ContentHolders,
  KeyedProjection,
  ProjectionAdvancer,
  ProjectionReader,
  RunOutcomeMapping,
} from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { CarriedTables } from '../layout/layout-steps.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import { contentReferencesOf, type ContentReferences } from '../references/content-references.ts';
import { factScrubsOf, type FactScrubs } from '../scrub/fact-scrubs.ts';
import type { InlineRegistration } from './inline-projection.ts';
import { preparedProjections, type NamedProjection } from './projection-fill.ts';
import { projectionRegistrations, type ProjectionKeeping } from './projection-keeping.ts';
import { projectionReader, type ProjectionStatements } from './projection-reads.ts';

export interface KeptTables extends CarriedTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeyedProjection[] | undefined;
  readonly holders?: ContentHolders | undefined;
  readonly mostBytesFilledAtOnce?: number | undefined;
}

type ProjectionDialect = ProjectionKeeping['dialect'];

export interface ProjectionParts {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeyedProjection[];
  readonly named: readonly NamedProjection[];
  readonly keepings: readonly ProjectionKeeping[];
  readonly scrubs: FactScrubs;
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly readerOn: (statements: ProjectionStatements) => ProjectionReader & ProjectionAdvancer;
  readonly references: ContentReferences;
}

export function projectionPartsOf(
  dialect: ProjectionDialect,
  { runOutcomes, projections = [], holders, mostBytesFilledAtOnce }: KeptTables,
): ProjectionParts {
  const kept = keptProjections(runOutcomes, projections);
  const keepings = kept.map((projection) => ({ dialect, projection }));
  const references = contentReferencesOf(dialect, holders, mostBytesFilledAtOnce);
  return {
    dialect,
    projections: kept,
    named: [...kept, ...references.named],
    keepings,
    scrubs: factScrubsOf(dialect, keepings, references),
    registrations: [...projectionRegistrations(dialect, kept), ...references.registrations],
    prepare: async (execute, inTransaction) => {
      await preparedProjections(keepings, execute, inTransaction, mostBytesFilledAtOnce);
      await references.prepare(execute, inTransaction);
    },
    readerOn: (statements) => projectionReader(dialect, kept, statements),
    references,
  };
}
