import { SQL } from '@event-driven-io/dumbo';
import type { RunOutcomeMapping, RunOutcomeSelection } from '@on.auto/operations';
import { Schema } from 'effect';

import type { RunOutcomesStore, StatementExecutor } from '../event-store.ts';
import { groupFields, groupOf } from './run-outcome-groups.ts';
import { runOutcomesTable } from './run-outcome-projection.ts';
import { keptOutcomesOnly } from './run-outcomes-reader.ts';

const table = SQL.plain(runOutcomesTable);

const GroupRows = Schema.Array(
  Schema.Struct({ ...groupFields, durations: Schema.fromJsonString(Schema.Array(Schema.Number)) }),
);

function selected({ definitionType, name }: RunOutcomeSelection): SQL {
  return SQL.concat(
    definitionType === undefined ? SQL.EMPTY : SQL` AND definition_type = ${definitionType}`,
    name === undefined ? SQL.EMPTY : SQL` AND name = ${name}`,
  );
}

function sqliteRunOutcomesReader(execute: StatementExecutor): RunOutcomesStore['readRunOutcomes'] {
  return async (playbookKey, { from, to }, selection) => {
    const { rows } = await execute.query(
      SQL`SELECT started_day AS day, definition_type, name, status, count(*) AS runs,
          coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(output_tokens), 0) AS output_tokens,
          coalesce(sum(cached_tokens), 0) AS cached_tokens,
          json_group_array(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS durations
        FROM ${table}
        WHERE playbook_key = ${playbookKey} AND started_day BETWEEN ${from} AND ${to}${selected(selection)}
        GROUP BY started_day, definition_type, name, status`,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

export function sqliteRunOutcomesOf(
  runOutcomes: RunOutcomeMapping | undefined,
  execute: StatementExecutor,
): RunOutcomesStore['readRunOutcomes'] {
  return keptOutcomesOnly(runOutcomes, sqliteRunOutcomesReader(execute));
}
