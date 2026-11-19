import type { SQL } from '@event-driven-io/dumbo';
import { ProjectionCatchingUp, projectedTableOf } from '@on.auto/operations';
import { Effect } from 'effect';

import type { CatchUpState, StatementExecutor } from '../event-store.ts';
import { isCaughtUp, type VersionedProjection } from '../projection-checkpoints/projection-checkpoints.ts';

export interface TablesCatchingUp {
  readonly includes: (projection: VersionedProjection) => boolean;
  readonly foundCaughtUp: (projection: VersionedProjection) => void;
  readonly answeredBy: (behind: readonly VersionedProjection[]) => void;
  readonly state: () => CatchUpState;
}

export function tablesCatchingUp(): TablesCatchingUp {
  const tables = new Set<string>();
  return {
    includes: (projection) => tables.has(projectedTableOf(projection)),
    foundCaughtUp: (projection) => {
      tables.delete(projectedTableOf(projection));
    },
    answeredBy: (behind) => {
      tables.clear();
      for (const projection of behind) {
        tables.add(projectedTableOf(projection));
      }
    },
    state: () => (tables.size === 0 ? 'caught_up' : 'catching_up'),
  };
}

export async function isCatchingUp(
  tables: TablesCatchingUp,
  projection: VersionedProjection,
  execute: Pick<StatementExecutor, 'query'>,
): Promise<boolean> {
  if (!tables.includes(projection)) {
    return false;
  }
  if (await isCaughtUp(execute, projection)) {
    tables.foundCaughtUp(projection);
    return false;
  }
  return true;
}

export type ServedOnceCaughtUp = (projection: VersionedProjection) => Effect.Effect<void>;

export function servedOnceCaughtUp(
  tables: TablesCatchingUp,
  read: (sql: SQL) => Promise<readonly unknown[]>,
): ServedOnceCaughtUp {
  const execute = { query: async (sql: SQL) => ({ rows: await read(sql) }) };
  return (projection) =>
    Effect.flatMap(
      Effect.promise(() => isCatchingUp(tables, projection, execute)),
      (catching) => (catching ? Effect.die(new ProjectionCatchingUp(projection.name)) : Effect.void),
    );
}
