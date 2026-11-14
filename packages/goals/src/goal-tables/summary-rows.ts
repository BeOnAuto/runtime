import { recordedDecoder, type KeyedProjection, type ProjectedRow } from '@on.auto/operations';
import { Option } from 'effect';

import { GoalSummaryEventSchema, goalSummariesKind, type RecordedGoalSummaryEvent } from '../goal-facts/goal-facts.ts';

export const summariesName = 'goal_summaries';

const summaryEventOf = recordedDecoder(GoalSummaryEventSchema);

const standing: ProjectedRow = { refused_at: null, attempt: null, detail: null, retry_at: null };

const lastOf = (row: ProjectedRow | undefined): ProjectedRow => ({
  last_due: row?.['last_due'] ?? null,
  last_run: row?.['last_run'] ?? null,
  started_at: row?.['started_at'] ?? null,
});

function summaryAfter(row: ProjectedRow | undefined, event: RecordedGoalSummaryEvent): ProjectedRow | undefined {
  if (event.type === 'goal_summary_started') {
    return {
      last_due: Date.parse(event.data.due),
      last_run: event.data.run,
      started_at: Date.parse(event.context.at),
      ...standing,
    };
  }
  if (event.data.change !== 'summary') {
    return undefined;
  }
  const { attempt, detail, retry_at } = event.data;
  return {
    ...lastOf(row),
    refused_at: Date.parse(event.context.at),
    attempt,
    detail,
    retry_at: retry_at === undefined ? null : Date.parse(retry_at),
  };
}

export const summaryRows: KeyedProjection = {
  name: summariesName,
  version: 1,
  kinds: [goalSummariesKind],
  types: ['goal_summary_started', 'goal_notice_refused'],
  columns: [
    { name: 'last_due', kind: 'integer' },
    { name: 'last_run', kind: 'text' },
    { name: 'started_at', kind: 'integer' },
    { name: 'refused_at', kind: 'integer' },
    { name: 'attempt', kind: 'integer' },
    { name: 'detail', kind: 'text' },
    { name: 'retry_at', kind: 'integer' },
  ],
  indexes: [{ name: 'retry_due', columns: ['retry_at'], acrossPlaybooks: true, whereSet: 'retry_at' }],
  advanced: [{ column: 'retry_at', setBy: ['goal_summary_started', 'goal_notice_refused'] }],
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.flatMap(summaryEventOf(message), (event) => Option.fromUndefinedOr(summaryAfter(row, event))),
    ),
};
