import type { ContentHolders, KeptProjection, RunOutcomeMapping, StreamProjection } from '@on.auto/operations';

import { definitionNamesRegistrations, type DefinitionNames } from '../definition-names/definition-names.ts';
import type { CarriedTables } from '../layout/layout-steps.ts';
import type { InlineRegistration } from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';

export interface KeptTables extends CarriedTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeptProjection[] | undefined;
  readonly streamProjections?: readonly StreamProjection[] | undefined;
  readonly holders?: ContentHolders | undefined;
  readonly mostBytesFilledAtOnce?: number | undefined;
  readonly definitionNames?: DefinitionNames | undefined;
}

export function namesKeptBy(
  dialect: ProjectionDialect,
  { definitionNames }: KeptTables,
): readonly InlineRegistration[] {
  return definitionNamesRegistrations(dialect, definitionNames);
}
