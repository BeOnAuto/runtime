import { SQL } from '@event-driven-io/dumbo';
import { projectedTableOf } from '@on.auto/operations';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import {
  projectionCheckpointsTableName,
  type VersionedProjection,
} from '../projection-checkpoints/projection-checkpoints.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';

const checkpoints = SQL.identifier(projectionCheckpointsTableName);

const CheckpointRows = Schema.Array(
  Schema.Struct({ projection: Schema.String, version: Schema.Number, folded_through: Schema.NullOr(Schema.String) }),
);

export type CheckpointRow = (typeof CheckpointRows.Type)[number];

export function rowOf(
  rows: readonly CheckpointRow[],
  { name, version }: VersionedProjection,
): CheckpointRow | undefined {
  return rows.find((row) => row.projection === name && row.version === version);
}

export async function checkpointRows(execute: StatementExecutor): Promise<readonly CheckpointRow[]> {
  const { rows } = await execute.query(SQL`SELECT projection, version, folded_through FROM ${checkpoints}`);
  return Schema.decodeUnknownSync(CheckpointRows)(rows);
}

export async function catchingUpLocked(
  execute: StatementExecutor,
  { forUpdate }: Pick<ProjectionDialect, 'forUpdate'>,
): Promise<readonly CheckpointRow[]> {
  const { rows } = await execute.query(
    SQL`SELECT projection, version, folded_through FROM ${checkpoints}
      WHERE folded_through IS NOT NULL${SQL.plain(forUpdate)}`,
  );
  return Schema.decodeUnknownSync(CheckpointRows)(rows);
}

export function startWritten({ name, version }: VersionedProjection, start: string): SQL {
  return SQL`INSERT INTO ${checkpoints} (projection, version, folded_through) VALUES (${name}, ${version}, ${start})
    ON CONFLICT (projection, version) DO UPDATE SET folded_through = excluded.folded_through`;
}

export function checkpointsAdvanced(
  { listed }: Pick<ProjectionDialect, 'listed'>,
  projections: readonly VersionedProjection[],
  through: string | null,
): SQL {
  const tables = projections.map((projection) => projectedTableOf(projection));
  return SQL`UPDATE ${checkpoints} SET folded_through = ${through}
    WHERE projection || '_' || version IN (${listed(tables)})`;
}
