import { statement } from '@on.auto/ledger';
import type { DispatchWatermark } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { runCaughtUp } from '../listeners/listener-rows.ts';
import { runLogStreamOf } from '../runs/run-address.ts';

const WatermarkRow = Schema.Struct({ dispatched_through: WholeNumber });

const RunRow = Schema.Struct({ run_key: Schema.String });

export function sqlWatermark(database: HostDatabase): DispatchWatermark {
  return {
    read: (runKey) =>
      Effect.orDie(
        rowsOf(
          WatermarkRow,
          database.read(statement`SELECT dispatched_through FROM workflow_runs WHERE run_key = ${runKey}`),
        ),
      ).pipe(Effect.map(([row]) => row?.dispatched_through ?? 0)),
    advance: (runKey, through) =>
      Effect.orDie(
        database.write(
          statement`INSERT INTO workflow_runs (run_key, stream_id, dispatched_through)
            VALUES (${runKey}, ${runLogStreamOf(runKey)}, ${through})
            ON CONFLICT (run_key) DO UPDATE SET dispatched_through = excluded.dispatched_through
            WHERE workflow_runs.dispatched_through < excluded.dispatched_through`,
        ),
      ).pipe(Effect.andThen(runCaughtUp(database, runKey, through))),
    behindRuns: (limit) =>
      Effect.orDie(
        rowsOf(
          RunRow,
          database.write(
            statement`UPDATE workflow_runs
              SET taken = (
                SELECT COALESCE(MAX(taken), 0) + 1 FROM workflow_runs
                WHERE ended_at IS NULL OR dispatched_through < ended_at
              )
              WHERE run_key IN (
                SELECT run.run_key FROM workflow_runs AS run
                JOIN emt_streams AS stream ON stream.stream_id = run.stream_id AND stream.is_archived = FALSE
                WHERE (run.ended_at IS NULL OR run.dispatched_through < run.ended_at)
                  AND stream.stream_position > run.dispatched_through
                ORDER BY run.taken, run.run_key
                LIMIT ${limit}
              )
              RETURNING run_key`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map(({ run_key: runKey }) => runKey))),
  };
}
