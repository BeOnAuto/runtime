import type { KeptProjection, ProjectionAdvancer, ProjectionReader } from '@on.auto/operations';

import { multiStreamAppendsOf, type MultiStreamAppendsOver } from '../multi-stream/emmett-multi-stream-appends.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import { catchUpPartsOf, type CatchUpParts } from '../projection-catch-up/catch-up-parts.ts';
import { contentReferencesOf, type ContentReferences } from '../references/content-references.ts';
import { factScrubsOf, type FactScrubs } from '../scrub/fact-scrubs.ts';
import { namesKeptBy, type KeptTables, type Preparing } from './kept-tables.ts';
import { projectionRegistrations, type ProjectionKeeping } from './projection-keeping.ts';
import { projectionReader, type ProjectionStatements } from './projection-reads.ts';

export type { KeptTables } from './kept-tables.ts';

type ProjectionDialect = ProjectionKeeping['dialect'];

export interface ProjectionParts {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeptProjection[];
  readonly named: readonly Pick<KeptProjection, 'name'>[];
  readonly keepings: readonly ProjectionKeeping[];
  readonly scrubs: FactScrubs;
  readonly registrations: ReturnType<typeof namesKeptBy>;
  readonly prepare: Preparing;
  readonly caughtUp: CatchUpParts['caughtUp'];
  readonly readerOn: (statements: ProjectionStatements) => ProjectionReader & ProjectionAdvancer;
  readonly references: ContentReferences;
  readonly multiStreamAppendsOver: MultiStreamAppendsOver;
}

export function projectionPartsOf(dialect: ProjectionDialect, tables: KeptTables): ProjectionParts {
  const { runOutcomes, projections = [], holders, tableMadeAgain } = tables;
  const kept = keptProjections(runOutcomes, projections);
  const keepings = kept.map((projection) => ({ dialect, projection }));
  const catchUp = catchUpPartsOf(dialect, keepings, tables);
  const references = contentReferencesOf(dialect, holders, catchUp.mostBytes);
  const scrubs = factScrubsOf(dialect, keepings, { references });
  const registrations = [
    ...projectionRegistrations(dialect, kept),
    ...references.registrations,
    ...namesKeptBy(dialect, tables),
  ];
  return {
    dialect,
    projections: kept,
    named: [...kept, ...references.named],
    keepings,
    scrubs,
    registrations,
    prepare: async (execute, inTransaction) => {
      await catchUp.reconciled(inTransaction);
      await references.prepare({ execute, inTransaction, madeAgain: tableMadeAgain });
    },
    caughtUp: catchUp.caughtUp,
    readerOn: (statements) => projectionReader(dialect, kept, statements),
    references,
    multiStreamAppendsOver: multiStreamAppendsOf(registrations),
  };
}
