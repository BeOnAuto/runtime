import type { ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import type { AssessmentState } from '../assessments/assessment-state.ts';
import type { RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';
import {
  NoticeRefusalsSchema,
  NoticesStartedSchema,
  type NoticeRefusals,
  type NoticesStarted,
} from './assessment-row-state.ts';

const noticesOfText = Schema.decodeUnknownOption(NoticesStartedSchema);

const textOfNotices = Schema.encodeSync(NoticesStartedSchema);

const refusalsOfText = Schema.decodeUnknownOption(NoticeRefusalsSchema);

const textOfRefusals = Schema.encodeSync(NoticeRefusalsSchema);

function noticesIn(row: ProjectedRow | undefined): NoticesStarted {
  return Option.getOrElse(noticesOfText(row?.['notices']), () => []);
}

function refusalsIn(row: ProjectedRow | undefined): NoticeRefusals {
  return Option.getOrElse(refusalsOfText(row?.['notice_refusals']), () => []);
}

function noticesAfter(
  row: ProjectedRow | undefined,
  before: AssessmentState,
  event: RecordedAssessmentEvent,
): NoticesStarted {
  const notices = noticesIn(row);
  if (event.type !== 'goal_notice_started' || before.started.some(({ change }) => change === event.data.change)) {
    return notices;
  }
  return [...notices, { change: event.data.change, at: event.context.at, run: event.data.run }];
}

function refusalsAfter(row: ProjectedRow | undefined, event: RecordedAssessmentEvent): NoticeRefusals {
  const refusals = refusalsIn(row);
  if (event.type === 'goal_notice_started') {
    return refusals.filter(({ change }) => change !== event.data.change);
  }
  if (event.type !== 'goal_notice_refused') {
    return refusals;
  }
  const { change, attempt, detail, retry_at } = event.data;
  return [
    ...refusals.filter((refusal) => refusal.change !== change),
    { change, attempt, detail, at: event.context.at, ...(retry_at === undefined ? {} : { retry_at }) },
  ];
}

function latestOf(moments: readonly string[]): number | null {
  return moments.length === 0 ? null : Math.max(...moments.map((moment) => Date.parse(moment)));
}

export function noticeColumnsAfter(
  row: ProjectedRow | undefined,
  before: AssessmentState,
  event: RecordedAssessmentEvent,
): ProjectedRow {
  const notices = noticesAfter(row, before, event);
  const refusals = refusalsAfter(row, event);
  return {
    notices: textOfNotices(notices),
    noticed_at: latestOf(notices.map(({ at }) => at)),
    notice_refusals: textOfRefusals(refusals),
    notice_refused_at: latestOf(refusals.map(({ at }) => at)),
  };
}
