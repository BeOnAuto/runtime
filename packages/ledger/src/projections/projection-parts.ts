import type { KeptProjection, ProjectionAdvancer, ProjectionReader } from '@on.auto/operations';

import { multiStreamAppendsOf, type MultiStreamAppendsOver } from '../multi-stream/emmett-multi-stream-appends.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import { contentReferencesOf, type ContentReferences } from '../references/content-references.ts';
import { factScrubsOf, type FactScrubs } from '../scrub/fact-scrubs.ts';
import { streamProjectionPartsOf, type StreamProjectionParts } from '../stream-projections/stream-projection-parts.ts';
import { namesKeptBy, type KeptTables } from './kept-tables.ts';
import { mostBytesInABatch, preparedProjections, type NamedProjection, type Preparing } from './projection-fill.ts';
import { projectionRegistrations, type ProjectionKeeping } from './projection-keeping.ts';
import { projectionReader, type ProjectionStatements } from './projection-reads.ts';

export type { KeptTables } from './kept-tables.ts';

type ProjectionDialect = ProjectionKeeping['dialect'];

export interface ProjectionParts {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeptProjection[];
  readonly named: readonly NamedProjection[];
  readonly keepings: readonly ProjectionKeeping[];
  readonly scrubs: FactScrubs;
  readonly registrations: ReturnType<typeof namesKeptBy>;
  readonly prepare: Preparing;
  readonly readerOn: (statements: ProjectionStatements) => ProjectionReader & ProjectionAdvancer;
  readonly references: ContentReferences;
  readonly streams: StreamProjectionParts;
  readonly multiStreamAppendsOver: MultiStreamAppendsOver;
}

export function projectionPartsOf(dialect: ProjectionDialect, tables: KeptTables): ProjectionParts {
  const { runOutcomes, projections = [], streamProjections = [], holders, mostBytesFilledAtOnce } = tables;
  const kept = keptProjections(runOutcomes, projections);
  const keepings = kept.map((projection) => ({ dialect, projection }));
  const references = contentReferencesOf(dialect, holders, mostBytesFilledAtOnce);
  const streams = streamProjectionPartsOf(dialect, streamProjections, mostBytesFilledAtOnce ?? mostBytesInABatch);
  const scrubs = factScrubsOf(dialect, keepings, { references, streams });
  const registrations = [
    ...projectionRegistrations(dialect, kept),
    ...references.registrations,
    ...streams.registrations,
    ...namesKeptBy(dialect, tables),
  ];
  return {
    dialect,
    projections: kept,
    named: [...kept, ...references.named, ...streams.named],
    keepings,
    scrubs,
    registrations,
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
    multiStreamAppendsOver: multiStreamAppendsOf(registrations),
  };
}
