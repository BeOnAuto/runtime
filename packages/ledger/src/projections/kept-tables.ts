import type { ContentHolders, KeptProjection, RunIds, RunOutcomeMapping } from '@on.auto/operations';

import { definitionNamesRegistrations, type DefinitionNames } from '../definition-names/definition-names.ts';
import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { CarriedTables } from '../layout/layout-steps.ts';
import type { CatchUpBudget } from '../projection-catch-up/caught-up.ts';
import { runIdsRegistrations } from '../run-ids/run-ids.ts';
import type { InlineRegistration } from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';

export interface KeptTables extends CarriedTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeptProjection[] | undefined;
  readonly holders?: ContentHolders | undefined;
  readonly mostBytesFilledAtOnce?: number | undefined;
  readonly catchUpBudget?: CatchUpBudget | undefined;
  readonly definitionNames?: DefinitionNames | undefined;
  readonly runIds?: RunIds | undefined;
  readonly tableMadeAgain?: ((table: string) => void) | undefined;
  readonly pageFailed?: ((position: string) => void) | undefined;
}

export type Preparing = (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;

export function namesKeptBy(
  dialect: ProjectionDialect,
  { definitionNames, runIds }: KeptTables,
): readonly InlineRegistration[] {
  return [...definitionNamesRegistrations(dialect, definitionNames), ...runIdsRegistrations(runIds)];
}
