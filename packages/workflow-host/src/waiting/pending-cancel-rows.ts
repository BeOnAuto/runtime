import { statement } from '@on.auto/ledger';
import { CancelOrderSchema, type CancelOrder } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface PendingCancelRow {
  readonly runKey: string;
  readonly cause: string;
  readonly cancel: CancelOrder;
}

const PendingRow = Schema.Struct({
  run_key: Schema.String,
  cause: Schema.String,
  cancelled_by: CancelOrderSchema.fields.by,
  kind: CancelOrderSchema.fields.kind,
  reason: CancelOrderSchema.fields.reason,
});

function pendingOf({
  run_key: runKey,
  cause,
  cancelled_by: by,
  kind,
  reason,
}: typeof PendingRow.Type): PendingCancelRow {
  return { runKey, cause, cancel: { by, kind, reason } };
}

export function passedOverRow(
  database: HostDatabase,
  { runKey, cause, cancel }: PendingCancelRow,
): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    database.write(
      statement`INSERT INTO workflow_pending_cancels (run_key, cause, cancelled_by, kind, reason)
        VALUES (${runKey}, ${cause}, ${cancel.by}, ${cancel.kind}, ${cancel.reason})
        ON CONFLICT (run_key) DO NOTHING`,
    ),
  );
}

export function pendingCancelRowsAfter(
  database: HostDatabase,
  after: string,
  most: number,
): Effect.Effect<readonly PendingCancelRow[], DatabaseFailed> {
  return rowsOf(
    PendingRow,
    database.read(
      statement`SELECT run_key, cause, cancelled_by, kind, reason FROM workflow_pending_cancels
        WHERE run_key > ${after} ORDER BY run_key LIMIT ${most}`,
    ),
  ).pipe(Effect.map((rows) => rows.map((row) => pendingOf(row))));
}

export function clearedPendingRow(database: HostDatabase, runKey: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(database.write(statement`DELETE FROM workflow_pending_cancels WHERE run_key = ${runKey}`));
}
