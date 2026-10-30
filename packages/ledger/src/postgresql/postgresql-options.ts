import type { KeyedProjection, RunOutcomeMapping } from '@on.auto/operations';
import { Pool } from 'pg';

import type { AppendListeners } from '../event-store.ts';
import type { LayoutStep } from '../layout/layout-steps.ts';
import type { FactSchemaRead } from '../layout/ledger-facts-refused.ts';

export interface PoolBounds {
  readonly max: number;
}

export type PostgreSQLPools = (bounds: PoolBounds) => Pool;

export function plainPoolsOn(connectionString: string): PostgreSQLPools {
  return ({ max }) => new Pool({ connectionString, max });
}

export interface PostgreSQLOptions extends AppendListeners {
  readonly pools: PostgreSQLPools;
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly layoutSteps?: readonly LayoutStep[];
  readonly factSchemas?: readonly FactSchemaRead[];
}
