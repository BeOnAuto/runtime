import type { KeyedProjection, RunOutcomeMapping } from '@on.auto/operations';
import { Pool } from 'pg';

import type { AppendObserver } from '../event-store.ts';

export interface PoolBounds {
  readonly max: number;
}

export type PostgreSQLPools = (bounds: PoolBounds) => Pool;

export function plainPoolsOn(connectionString: string): PostgreSQLPools {
  return ({ max }) => new Pool({ connectionString, max });
}

export interface PostgreSQLOptions {
  readonly pools: PostgreSQLPools;
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
  readonly observer?: AppendObserver | undefined;
}
