import { SQL } from '@event-driven-io/dumbo';
import type { RunOutcomeMapping, RunOutcomeSelection } from '@on.auto/operations';
import { Schema } from 'effect';

import { definitionNames } from '../definition-names/definition-names-table.ts';
import type { RunOutcomesStore, StatementExecutor } from '../event-store.ts';
import { servedOnceCaughtUp, type TablesCatchingUp } from '../projection-catch-up/catching-up.ts';
import { groupFields, groupOf, nameHeldNow } from './run-outcome-groups.ts';
import { runOutcomesTable } from './run-outcome-projection.ts';
import { keptOutcomesOnly } from './run-outcomes-reader.ts';

const table = SQL.plain(runOutcomesTable);

const GroupRows = Schema.Array(
  Schema.Struct({ ...groupFields, durations: Schema.fromJsonString(Schema.Array(Schema.Number)) }),
);

const nameHeld = SQL.plain(nameHeldNow);

function selected({ definitionType, name }: RunOutcomeSelection): SQL {
  return SQL.concat(
    definitionType === undefined ? SQL.EMPTY : SQL` AND o.definition_type = ${definitionType}`,
    name === undefined ? SQL.EMPTY : SQL` AND ${nameHeld} = ${name}`,
  );
}

function sqliteRunOutcomesReader(execute: StatementExecutor): RunOutcomesStore['readRunOutcomes'] {
  return async (playbookKey, { from, to }, selection) => {
    const { rows } = await execute.query(
      SQL`SELECT o.started_day AS day, o.definition_type, ${nameHeld} AS name, o.status, count(*) AS runs,
          coalesce(sum(o.input_tokens), 0) AS input_tokens, coalesce(sum(o.output_tokens), 0) AS output_tokens,
          coalesce(sum(o.cached_tokens), 0) AS cached_tokens, sum(o.cost_micro_usd) AS cost_micro_usd,
          json_group_array(o.duration_ms) FILTER (WHERE o.duration_ms IS NOT NULL) AS durations
        FROM ${table} AS o JOIN ${definitionNames} AS n ON n.definition_key = o.playbook_key
        WHERE n.playbook_key = ${playbookKey} AND o.started_day BETWEEN ${from} AND ${to}${selected(selection)}
        GROUP BY o.started_day, o.playbook_key, o.definition_type, ${nameHeld}, o.status`,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

export function sqliteRunOutcomesOf(
  runOutcomes: RunOutcomeMapping | undefined,
  execute: StatementExecutor,
  catchingUp: TablesCatchingUp,
): RunOutcomesStore['readRunOutcomes'] {
  const served = servedOnceCaughtUp(catchingUp, async (sql) => (await execute.query(sql)).rows);
  return keptOutcomesOnly(runOutcomes, sqliteRunOutcomesReader(execute), served);
}
