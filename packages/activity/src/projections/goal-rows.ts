import {
  ActedContextSchema,
  recordedDecoder,
  type KeyedProjection,
  type ProjectedColumn,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedStream,
} from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { assessmentKeyOf } from '../positions/activity-addresses.ts';

export const goalVerdictsName = 'activity_goals';

export const goalOverduesName = 'activity_goal_overdues';

const assessmentsKind = 'assessments';

const ToldSchema = Schema.Literals(['now', 'summary', 'quiet']);

const GoalBellFactSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('goal_assessment_opened'),
    data: Schema.Struct({ goal: Schema.String }),
    context: ActedContextSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('goal_observed'),
    data: Schema.Struct({ title: Schema.optionalKey(Schema.String), says: Schema.optionalKey(Schema.String) }),
    context: ActedContextSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('goal_assessed'),
    data: Schema.Struct({ verdict: Schema.Literals(['passed', 'failed']), at: Schema.String, told: ToldSchema }),
    context: ActedContextSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('goal_overdue'),
    data: Schema.Struct({ since: Schema.String, told: ToldSchema }),
    context: ActedContextSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('goal_assessment_ended'),
    data: Schema.Struct({ reason: Schema.String }),
    context: ActedContextSchema,
  }),
]);

type GoalBellFact = typeof GoalBellFactSchema.Type;

const goalBellFactOf = recordedDecoder(GoalBellFactSchema);

function keyOf(_message: ProjectedMessage, { id }: ProjectedStream): string {
  return assessmentKeyOf(id);
}

function openedOf(goal: string, shown: ProjectedRow): ProjectedRow {
  return { ...shown, at: null, goal, outcome: null, title: null, says: null };
}

function observedAfter(row: ProjectedRow, { title, says }: { readonly title?: string; readonly says?: string }) {
  const settled = row['outcome'] !== null && row['outcome'] !== 'overdue';
  return {
    ...row,
    ...(title === undefined ? {} : { title }),
    ...(says === undefined || settled ? {} : { says }),
  };
}

function isTold(told: string): boolean {
  return told !== 'quiet';
}

function verdictAfter(row: ProjectedRow | undefined, fact: GoalBellFact): ProjectedRow | undefined {
  if (fact.type === 'goal_assessment_opened') {
    return row === undefined ? openedOf(fact.data.goal, { listed: false, by: null, result_at: null }) : undefined;
  }
  if (row === undefined) {
    return undefined;
  }
  if (fact.type === 'goal_observed') {
    return observedAfter(row, fact.data);
  }
  return fact.type === 'goal_assessed' && row['outcome'] === null
    ? {
        ...row,
        listed: isTold(fact.data.told),
        by: fact.context.by,
        outcome: fact.data.verdict,
        at: Date.parse(fact.context.at),
        result_at: Date.parse(fact.data.at),
      }
    : undefined;
}

function overdueAfter(row: ProjectedRow | undefined, fact: GoalBellFact): ProjectedRow | undefined {
  if (fact.type === 'goal_assessment_opened') {
    return row === undefined ? openedOf(fact.data.goal, { open: false }) : undefined;
  }
  if (row === undefined) {
    return undefined;
  }
  if (fact.type === 'goal_observed') {
    return observedAfter(row, fact.data);
  }
  if (fact.type === 'goal_overdue') {
    return row['outcome'] === null
      ? { ...row, open: isTold(fact.data.told), outcome: 'overdue', at: Date.parse(fact.data.since) }
      : undefined;
  }
  return row['open'] === true ? { ...row, open: false } : undefined;
}

function folding(after: (row: ProjectedRow | undefined, fact: GoalBellFact) => ProjectedRow | undefined) {
  return (row: ProjectedRow | undefined, message: ProjectedMessage) =>
    Option.getOrUndefined(Option.flatMap(goalBellFactOf(message), (fact) => Option.fromUndefinedOr(after(row, fact))));
}

const shownColumns: readonly ProjectedColumn[] = [
  { name: 'at', kind: 'integer' },
  { name: 'goal', kind: 'text' },
  { name: 'outcome', kind: 'text' },
  { name: 'title', kind: 'text' },
  { name: 'says', kind: 'text' },
];

export const goalVerdictRows: KeyedProjection = {
  name: goalVerdictsName,
  version: 3,
  kinds: [assessmentsKind],
  types: ['goal_assessment_opened', 'goal_observed', 'goal_assessed'],
  columns: [
    { name: 'listed', kind: 'boolean' },
    { name: 'by', kind: 'text' },
    ...shownColumns,
    { name: 'result_at', kind: 'integer' },
  ],
  indexes: [
    { name: 'listed', columns: ['listed', 'at', 'row_key'] },
    { name: 'listed_by', columns: ['listed', 'by', 'at', 'row_key'] },
  ],
  keyOf,
  rowAfter: folding(verdictAfter),
};

export const goalOverdueRows: KeyedProjection = {
  name: goalOverduesName,
  version: 1,
  kinds: [assessmentsKind],
  types: ['goal_assessment_opened', 'goal_observed', 'goal_overdue', 'goal_assessed', 'goal_assessment_ended'],
  columns: [{ name: 'open', kind: 'boolean' }, ...shownColumns],
  indexes: [{ name: 'open', columns: ['open', 'at', 'row_key'] }],
  keyOf,
  rowAfter: folding(overdueAfter),
};
