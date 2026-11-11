import type {
  ContentHolders,
  KeptProjection,
  ProjectionAdvancer,
  ProjectionReader,
  RunOutcomeMapping,
  StreamProjection,
} from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { CarriedTables } from '../layout/layout-steps.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import { contentReferencesOf, type ContentReferences } from '../references/content-references.ts';
import { factScrubsOf, type FactScrubs } from '../scrub/fact-scrubs.ts';
import { streamProjectionPartsOf, type StreamProjectionParts } from '../stream-projections/stream-projection-parts.ts';
import { mostBytesInABatch, preparedProjections, type NamedProjection } from './projection-fill.ts';
import { projectionRegistrations, type ProjectionKeeping } from './projection-keeping.ts';
import { projectionReader, type ProjectionStatements } from './projection-reads.ts';

export interface KeptTables extends CarriedTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeptProjection[] | undefined;
  readonly streamProjections?: readonly StreamProjection[] | undefined;
  readonly holders?: ContentHolders | undefined;
  readonly mostBytesFilledAtOnce?: number | undefined;
}

type ProjectionDialect = ProjectionKeeping['dialect'];

export interface ProjectionParts {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeptProjection[];
  readonly named: readonly NamedProjection[];
  readonly keepings: readonly ProjectionKeeping[];
  readonly scrubs: FactScrubs;
  readonly registrations: ReturnType<typeof projectionRegistrations>;
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly readerOn: (statements: ProjectionStatements) => ProjectionReader & ProjectionAdvancer;
  readonly references: ContentReferences;
  readonly streams: StreamProjectionParts;
}

export function projectionPartsOf(
  dialect: ProjectionDialect,
  { runOutcomes, projections = [], streamProjections = [], holders, mostBytesFilledAtOnce }: KeptTables,
): ProjectionParts {
  const kept = keptProjections(runOutcomes, projections);
  const keepings = kept.map((projection) => ({ dialect, projection }));
  const references = contentReferencesOf(dialect, holders, mostBytesFilledAtOnce);
  const streams = streamProjectionPartsOf(dialect, streamProjections, mostBytesFilledAtOnce ?? mostBytesInABatch);
  return {
    dialect,
    projections: kept,
    named: [...kept, ...references.named, ...streams.named],
    keepings,
    scrubs: factScrubsOf(dialect, keepings, { references, streams }),
    registrations: [...projectionRegistrations(dialect, kept), ...references.registrations, ...streams.registrations],
    prepare: async (execute, inTransaction) => {
      await preparedProjections(keepings, execute, inTransaction, mostBytesFilledAtOnce);
      await references.prepare(execute, inTransaction);
      await streams.prepare(execute, inTransaction);
    },
    readerOn: (statements) =>
      projectionReader(dialect, [...kept, ...streams.tables], statements, {
        fresh: streams.freshOn(statements),
        reset: streams.resetOn(statements.inTransaction),
      }),
    references,
    streams,
  };
}
