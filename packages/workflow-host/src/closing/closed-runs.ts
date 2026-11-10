import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export const closingBounds = {
  quietMs: 24 * 60 * 60 * 1000,
  runsInAPass: 64,
} as const;

export interface EndOfARun {
  readonly runKey: string;
  readonly endedAt: number;
  readonly endedTime: number;
}

const EndRow = Schema.Struct({ run_key: Schema.String, ended_at: WholeNumber, ended_time: WholeNumber });

const SoonestRow = Schema.Struct({ soonest: Schema.NullOr(WholeNumber) });

function endOf({ run_key: runKey, ended_at: endedAt, ended_time: endedTime }: typeof EndRow.Type): EndOfARun {
  return { runKey, endedAt, endedTime };
}

export function closableRuns(
  database: HostDatabase,
  endedBefore: number,
  most: number,
): Effect.Effect<readonly EndOfARun[], DatabaseFailed> {
  return Effect.map(
    rowsOf(
      EndRow,
      database.read(
        statement`SELECT run.run_key, run.ended_at, run.ended_time FROM workflow_runs AS run
          WHERE run.closed_at IS NULL AND run.ended_time <= ${endedBefore}
            AND run.ended_at IS NOT NULL AND run.dispatched_through >= run.ended_at
            AND EXISTS (
              SELECT 1 FROM workflow_settlements AS settled
              WHERE settled.run_key = run.run_key AND settled.settlement IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM workflow_calls AS open
              WHERE open.run_key = run.run_key AND open.state <> 'closed'
                AND (open.state IN ('running', 'waiting') OR (open.state = 'answered' AND open.delivered = 0))
            )
          ORDER BY run.ended_time, run.run_key
          LIMIT ${most}`,
      ),
    ),
    (rows) => rows.map((row) => endOf(row)),
  );
}

export function soonestEndAfter(database: HostDatabase, after: number): Effect.Effect<number | null, DatabaseFailed> {
  return Effect.map(
    oneRowOf(
      SoonestRow,
      database.read(
        statement`SELECT MIN(ended_time) AS soonest FROM workflow_runs
          WHERE closed_at IS NULL AND ended_time > ${after}`,
      ),
    ),
    ({ soonest }) => soonest,
  );
}

export function closedRun(
  database: HostDatabase,
  { runKey, endedAt, endedTime }: EndOfARun,
  now: number,
): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.map(
    database.transaction([
      statement`UPDATE workflow_calls SET state = 'closed', call = NULL, attributes = NULL, result = NULL
        WHERE run_key = ${runKey} AND state <> 'closed' AND NOT EXISTS (
          SELECT 1 FROM workflow_calls AS open
          WHERE open.run_key = ${runKey} AND open.state <> 'closed'
            AND (open.state IN ('running', 'waiting') OR (open.state = 'answered' AND open.delivered = 0))
        )`,
      statement`UPDATE workflow_runs SET closed_at = ${now},
          ended_at = COALESCE(ended_at, ${endedAt}), ended_time = COALESCE(ended_time, ${endedTime})
        WHERE run_key = ${runKey} AND closed_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM workflow_calls WHERE run_key = ${runKey} AND state <> 'closed'
        )
        RETURNING run_key`,
    ]),
    (rows) => rows.length > 0,
  );
}
