import { withinDetailBytes, type Goal } from '@on.auto/definitions/goals';
import { PlaybookReader } from '@on.auto/operations';
import type { GoalGap } from '@on.auto/playbooks';
import { Effect } from 'effect';

import { goalSummariesStreamIdOf } from '../goal-tables/goal-streams.ts';
import { summariesName } from '../goal-tables/summary-rows.ts';
import { isDayLimitDetail, lowered, sendingResumes, withoutClosingPeriod } from '../notice-limits/notice-day-limit.ts';

function notSentWords({ id, notify }: Goal, detail: string): string {
  if (isDayLimitDetail(detail)) {
    return `The summary of the goal ${id} was not sent, because ${lowered(detail)}. ${sendingResumes}.`;
  }
  const through = notify?.summary?.through ?? notify?.through ?? 'its notification function';
  return `The summary of the goal ${id} was not sent. ${withoutClosingPeriod(detail)}. Make sure ${through} is saved, active and accepts the fields of a summary; the next summary is then sent.`;
}

export function summaryNotStartedGap(goal: Goal, detail: string): GoalGap {
  return {
    kind: 'notice_not_started',
    goal: goal.id,
    detail: withinDetailBytes(notSentWords(goal, detail)),
    fixed_by: 'agent',
  };
}

export function summaryGapsIn(goal: Goal): Effect.Effect<readonly GoalGap[], never, PlaybookReader> {
  if (goal.notify?.summary === undefined) {
    return Effect.succeed([]);
  }
  return PlaybookReader.use((reader) =>
    Effect.map(
      reader.readProjectedRows(summariesName, {
        where: [{ column: 'row_key', equals: goalSummariesStreamIdOf(goal.id) }],
        orderBy: [],
        order: 'asc',
        limit: 1,
      }),
      ([found]) => {
        const detail = found?.row['detail'];
        const givenUp = typeof found?.row['refused_at'] === 'number' && found.row['retry_at'] === null;
        return givenUp && typeof detail === 'string' ? [summaryNotStartedGap(goal, detail)] : [];
      },
    ),
  );
}
