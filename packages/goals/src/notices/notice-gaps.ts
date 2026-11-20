import type { Goal, HeldGoal } from '@on.auto/definitions/goals';
import { PlaybookReader } from '@on.auto/operations';
import type { GoalGap } from '@on.auto/playbooks';
import { Effect, Schema } from 'effect';

import { NoticeRefusalsSchema, type NoticeRefusals } from '../goal-tables/assessment-row-state.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { messageSaying, newestNoticeOf, undeliveredGapsOf } from '../notice-deliveries/notice-deliveries.ts';
import { isDayLimitDetail, lowered, sendingResumes, withoutClosingPeriod } from '../notice-limits/notice-day-limit.ts';
import { summaryGapsIn } from '../summaries/summary-gaps.ts';

const refusalsOfText = Schema.decodeUnknownSync(NoticeRefusalsSchema);

const mostRefusedRowsRead = 20;

type Refusal = NoticeRefusals[number];

function notSentWords({ id, notify }: Goal, { change, detail }: Refusal): string {
  const message = messageSaying(id, change);
  if (isDayLimitDetail(detail)) {
    const shown = notify?.summary === undefined ? 'in Studio' : 'in Studio and in the next summary';
    return `${message} was not sent, because ${lowered(detail)}. ${sendingResumes}, and the change shows ${shown}.`;
  }
  const through = notify?.through ?? 'its notification function';
  return `${message} was not sent. ${withoutClosingPeriod(detail)}. Make sure ${through} is saved, active and accepts the fields of a message; the next message is then sent.`;
}

export function noticeNotStartedGap(goal: Goal, refusal: Refusal): GoalGap {
  return { kind: 'notice_not_started', goal: goal.id, detail: notSentWords(goal, refusal), fixed_by: 'agent' };
}

function standingRefusalOf(text: unknown): Refusal | undefined {
  return refusalsOfText(text).findLast(({ retry_at }) => retry_at === undefined);
}

function newestRowsOf({ definition }: HeldGoal, column: string, limit: number) {
  return PlaybookReader.use((reader) =>
    reader.ofDefinition(definition).readProjectedRows(assessmentsName, {
      where: [{ column, after: 0 }],
      orderBy: [column],
      order: 'desc',
      limit,
    }),
  );
}

function latestNoticeAt(rows: readonly { readonly row: Readonly<Record<string, unknown>> }[]): number {
  const at = rows[0]?.row['noticed_at'];
  return typeof at === 'number' ? at : 0;
}

function goalGapsIn(held: HeldGoal): Effect.Effect<readonly GoalGap[], never, PlaybookReader> {
  const { goal } = held;
  return Effect.flatMap(newestRowsOf(held, 'notice_refused_at', mostRefusedRowsRead), (refused) =>
    Effect.flatMap(newestRowsOf(held, 'noticed_at', 1), (noticed) => {
      const startedAt = latestNoticeAt(noticed);
      const refusal = refused
        .map(({ row }) => standingRefusalOf(row['notice_refusals']))
        .find((found) => found !== undefined && Date.parse(found.at) > startedAt);
      const notStarted = refusal === undefined ? [] : [noticeNotStartedGap(goal, refusal)];
      return Effect.map(undeliveredGapsOf(goal, newestNoticeOf(noticed[0]?.row['notices'])), (undelivered) => [
        ...notStarted,
        ...undelivered,
      ]);
    }),
  );
}

export function noticeGapsIn(held: readonly HeldGoal[]): Effect.Effect<readonly GoalGap[], never, PlaybookReader> {
  return Effect.map(
    Effect.forEach(
      held.filter(({ goal }) => goal.retired !== true),
      (goal) =>
        Effect.map(Effect.all([goalGapsIn(goal), summaryGapsIn(goal)]), (found: readonly (readonly GoalGap[])[]) =>
          found.flat(),
        ),
    ),
    (gaps: readonly (readonly GoalGap[])[]) => gaps.flat(),
  );
}
