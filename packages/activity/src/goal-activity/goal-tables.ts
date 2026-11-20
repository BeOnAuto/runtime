import { addressOfTheRow, streamPrefixOfAddress, type ProjectedKeyedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import type { ActivityKind, ActivityRow, GoalShown } from '../operations/activity-row.ts';
import { activityTables, type ActivityTable } from '../operations/activity-tables.ts';
import { goalOverduesName, goalVerdictsName } from '../projections/goal-rows.ts';

const shownColumns = {
  at: Schema.Int,
  by: Schema.String,
  title: Schema.NullOr(Schema.String),
  says: Schema.NullOr(Schema.String),
};

const VerdictColumnsSchema = Schema.Struct({
  ...shownColumns,
  outcome: Schema.Literals(['passed', 'failed']),
  result_at: Schema.Int,
});

const OverdueColumnsSchema = Schema.Struct({ ...shownColumns, outcome: Schema.Literal('overdue') });

const verdictColumnsOf = Schema.decodeUnknownOption(VerdictColumnsSchema);

const overdueColumnsOf = Schema.decodeUnknownOption(OverdueColumnsSchema);

interface Judged extends GoalShown {
  readonly at: number;
  readonly by: string;
}

function goalKeyOf(kept: ProjectedKeyedRow): string {
  return streamPrefixOfAddress(addressOfTheRow(kept));
}

function goalRowOf(kind: ActivityKind, playbook: string, key: string, judged: Judged): ActivityRow {
  const { at, by, goalKey, outcome, title, says, resultAt } = judged;
  return {
    kind,
    form: 'assessment',
    position: { at, resultAt, playbook, key },
    by,
    by_name: null,
    change: null,
    trigger: null,
    definition: null,
    run_id: null,
    output_shape: null,
    message: null,
    answer_schema: null,
    detail: null,
    status: null,
    waits_on: null,
    expires_at: null,
    about: null,
    goal: { goalKey, outcome, title, says, resultAt },
  };
}

function asKept(key: string): string {
  return key;
}

export const goalVerdictTable: ActivityTable = {
  kind: 'goal',
  projection: goalVerdictsName,
  openColumn: 'listed',
  atColumn: 'at',
  seenByColumn: 'by',
  rowKeyOf: asKept,
  rowsOf: (playbook, kept: ProjectedKeyedRow) =>
    Option.toArray(verdictColumnsOf(kept.row)).map(({ result_at: resultAt, ...columns }) =>
      goalRowOf('goal', playbook, kept.key, { ...columns, goalKey: goalKeyOf(kept), resultAt }),
    ),
};

const goalOverdueTable: ActivityTable = {
  kind: 'goal_overdue',
  projection: goalOverduesName,
  openColumn: 'open',
  atColumn: 'at',
  seenByColumn: 'by',
  rowKeyOf: asKept,
  rowsOf: (playbook, kept: ProjectedKeyedRow) =>
    Option.toArray(overdueColumnsOf(kept.row)).map((columns) =>
      goalRowOf('goal_overdue', playbook, kept.key, { ...columns, goalKey: goalKeyOf(kept), resultAt: columns.at }),
    ),
};

export const tablesWithGoals: readonly ActivityTable[] = [...activityTables, goalVerdictTable, goalOverdueTable];
