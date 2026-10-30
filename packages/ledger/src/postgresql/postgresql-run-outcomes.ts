import { SQL } from '@event-driven-io/dumbo';
import type { RunOutcomeMapping, RunOutcomeSelection } from '@on.auto/operations';
import { Schema } from 'effect';

import type { RunOutcomesStore, StatementExecutor } from '../event-store.ts';
import { groupFields, groupOf } from '../outcomes/run-outcome-groups.ts';
import { runOutcomesTable } from '../outcomes/run-outcome-projection.ts';
import { keptOutcomesOnly } from '../outcomes/run-outcomes-reader.ts';
import { binding, type Bind, type Query } from '../postgresql-reads/recorded-parts.ts';

const GroupRows = Schema.Array(Schema.Struct({ ...groupFields, durations: Schema.Array(Schema.Number) }));

function selected(bind: Bind, { definitionType, name }: RunOutcomeSelection): string {
  const ofDefinitionType = definitionType === undefined ? '' : ` AND definition_type = ${bind(definitionType)}`;
  return name === undefined ? ofDefinitionType : `${ofDefinitionType} AND name = ${bind(name)}`;
}

export function postgresqlRunOutcomesReader(query: Query): RunOutcomesStore['readRunOutcomes'] {
  return async (playbookKey, { from, to }, selection) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT started_day AS day, definition_type, name, status, count(*)::int AS runs,
          coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
          coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
          coalesce(sum(cached_tokens), 0)::float8 AS cached_tokens,
          coalesce(json_agg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), '[]'::json) AS durations
        FROM ${runOutcomesTable}
        WHERE playbook_key = ${bind(playbookKey)} AND started_day BETWEEN ${bind(from)} AND ${bind(to)}${selected(bind, selection)}
        GROUP BY started_day, definition_type, name, status`,
      values,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

export function postgresqlRunOutcomesOf(
  runOutcomes: RunOutcomeMapping | undefined,
  query: Query,
): RunOutcomesStore['readRunOutcomes'] {
  return keptOutcomesOnly(runOutcomes, postgresqlRunOutcomesReader(query));
}

export const emmettsMigrationLock = 999_956_789;

export const longestMigrationLockWaitMs = 60_000;

const lockTriedEveryMs = 100;

interface LockWaiting {
  readonly mostWaitMs: number;
  readonly now: () => number;
  readonly pause: (milliseconds: number) => Promise<unknown>;
}

const onTheSystemClock: LockWaiting = {
  mostWaitMs: longestMigrationLockWaitMs,
  now: () => performance.now(),
  pause: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
};

const LockRows = Schema.Array(Schema.Struct({ locked: Schema.Boolean }));

async function tookTheLock(execute: StatementExecutor): Promise<boolean> {
  const { rows } = await execute.query(SQL`SELECT pg_try_advisory_xact_lock(${emmettsMigrationLock}) AS locked`);
  return Schema.decodeUnknownSync(LockRows)(rows).some(({ locked }) => locked);
}

async function lockTakenBy(execute: StatementExecutor, deadline: number, waiting: LockWaiting): Promise<void> {
  if (await tookTheLock(execute)) {
    return;
  }
  if (waiting.now() >= deadline) {
    throw new Error(
      `Another server held the migration lock of the ledger's database for more than ${waiting.mostWaitMs / 1000} s, so this one does not start; start it again once that server is ready`,
    );
  }
  await waiting.pause(lockTriedEveryMs);
  await lockTakenBy(execute, deadline, waiting);
}

export function migrationLockTakenWithin(
  waiting: LockWaiting = onTheSystemClock,
): (migration: { readonly execute: StatementExecutor }) => Promise<void> {
  return ({ execute }) => lockTakenBy(execute, waiting.now() + waiting.mostWaitMs, waiting);
}
