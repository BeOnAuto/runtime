import { playbookCallerOf, type ProjectedKeyedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import type { ActivityKind, ActivityRow, GoalShown } from '../operations/activity-row.ts';
import { activityTables, type ActivityTable } from '../operations/activity-tables.ts';
import { goalOverduesName, goalVerdictsName } from '../projections/goal-rows.ts';

const shownColumns = {
  at: Schema.Int,
  goal: Schema.String,
  title: Schema.NullOr(Schema.String),
  says: Schema.NullOr(Schema.String),
};

const VerdictColumnsSchema = Schema.Struct({
  ...shownColumns,
  by: Schema.String,
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

function goalRowOf(kind: ActivityKind, playbook: string, key: string, judged: Judged): ActivityRow {
  const { at, by, goal, outcome, title, says, resultAt } = judged;
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
    goal: { goal, outcome, title, says, resultAt },
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
  rowsOf: (playbook, { key, row }: ProjectedKeyedRow) =>
    Option.toArray(verdictColumnsOf(row)).map(({ result_at: resultAt, ...columns }) =>
      goalRowOf('goal', playbook, key, { ...columns, resultAt }),
    ),
};

const goalOverdueTable: ActivityTable = {
  kind: 'goal_overdue',
  projection: goalOverduesName,
  openColumn: 'open',
  atColumn: 'at',
  seenByColumn: 'goal',
  rowKeyOf: asKept,
  rowsOf: (playbook, { key, row }: ProjectedKeyedRow) =>
    Option.toArray(overdueColumnsOf(row)).map((columns) =>
      goalRowOf('goal_overdue', playbook, key, {
        ...columns,
        resultAt: columns.at,
        by: playbookCallerOf({ org: '', playbook }).id,
      }),
    ),
};

export const tablesWithGoals: readonly ActivityTable[] = [...activityTables, goalVerdictTable, goalOverdueTable];
