import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export const settleAttemptsBeforeBackingOff = 20;

export const settleBackOffMs = 60_000;

const AttemptsRow = Schema.Struct({ attempts: WholeNumber });

export function attempted(database: HostDatabase, runKey: string, at: number): Effect.Effect<number, DatabaseFailed> {
  return oneRowOf(
    AttemptsRow,
    database.write(
      statement`INSERT INTO workflow_settlements (run_key, attempts, last_attempt_at) VALUES (${runKey}, 1, ${at})
        ON CONFLICT (run_key) DO UPDATE SET attempts = workflow_settlements.attempts + 1,
          last_attempt_at = excluded.last_attempt_at
        RETURNING attempts`,
    ),
  ).pipe(Effect.map(({ attempts }) => attempts));
}

export function isBackingOff(attempts: number, lastAttemptAt: number | null, now: number): boolean {
  return attempts >= settleAttemptsBeforeBackingOff && lastAttemptAt !== null && now - lastAttemptAt < settleBackOffMs;
}

export function backOffLifted(database: HostDatabase, runKey: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    database.write(
      statement`UPDATE workflow_settlements SET last_attempt_at = NULL
        WHERE run_key = ${runKey} AND settlement IS NULL`,
    ),
  );
}
