import { GoalEventSchema, WeekdaySchema, type Goal, type RecordedGoalEvent } from '@on.auto/definitions/goals';
import { recordedDecoder, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import { Option, Result, Schema } from 'effect';

import { nextCalendarOpeningOf } from '../goal-clock/goal-clock.ts';
import {
  AssessmentEventSchema,
  GoalSummaryEventSchema,
  assessmentsKind,
  goalSummariesKind,
  type RecordedAssessmentEvent,
  type RecordedGoalSummaryEvent,
} from '../goal-facts/goal-facts.ts';
import { isCalendarRule, type CalendarWindowRule, type Instant } from '../goal-rules/goal-rule.ts';
import { windowOpeningAfter } from '../windows/window-times.ts';

export const clocksName = 'goal_clocks';

const goalsKind = 'goals';

export const clockKey = 'clock';

const CalendarSchema = Schema.Struct({
  calendar: Schema.Literals(['day', 'week', 'month']),
  time_zone: Schema.optionalKey(Schema.String),
  grace: Schema.optionalKey(Schema.String),
  days: Schema.optionalKey(Schema.Array(WeekdaySchema)),
});

const GoalClockSchema = Schema.Struct({
  first_saved_at: Schema.Finite,
  retired: Schema.optionalKey(Schema.Boolean),
  removed: Schema.optionalKey(Schema.Literal(true)),
  calendar: Schema.optionalKey(CalendarSchema),
  summary: Schema.optionalKey(Schema.Struct({ cron: Schema.String, time_zone: Schema.optionalKey(Schema.String) })),
  latest_opened: Schema.optionalKey(Schema.Finite),
  last_summary: Schema.optionalKey(Schema.Finite),
});

const GoalClockTextSchema = Schema.fromJsonString(GoalClockSchema);

export type GoalClockEntry = typeof GoalClockSchema.Type;

const clockOfText = Schema.decodeUnknownOption(GoalClockTextSchema);

const textOfClock = Schema.encodeSync(GoalClockTextSchema);

export function goalClockIn(row: ProjectedRow | undefined): GoalClockEntry | undefined {
  return Option.getOrUndefined(clockOfText(row?.['clock']));
}

const goalEventOf = recordedDecoder(GoalEventSchema);

type Opening = Extract<RecordedAssessmentEvent, { readonly type: 'goal_assessment_opened' }>;

type SummaryStart = Extract<RecordedGoalSummaryEvent, { readonly type: 'goal_summary_started' }>;

const isOpening = (event: RecordedAssessmentEvent): event is Opening => event.type === 'goal_assessment_opened';

const isSummaryStart = (event: RecordedGoalSummaryEvent): event is SummaryStart =>
  event.type === 'goal_summary_started';

const assessmentEventOf = recordedDecoder(AssessmentEventSchema);

const summaryEventOf = recordedDecoder(GoalSummaryEventSchema);

const openedEventOf = (message: ProjectedMessage) => Option.filter(assessmentEventOf(message), isOpening);

const summaryStartOf = (message: ProjectedMessage) => Option.filter(summaryEventOf(message), isSummaryStart);

function calendarOf(goal: Goal): CalendarWindowRule | undefined {
  return goal.window !== undefined && isCalendarRule(goal.window) ? goal.window : undefined;
}

function summaryOf(goal: Goal): Pick<GoalClockEntry, 'summary'> {
  const summary = goal.notify?.summary;
  if (summary === undefined) {
    return {};
  }
  return {
    summary: { cron: summary.cron, ...(summary.time_zone === undefined ? {} : { time_zone: summary.time_zone }) },
  };
}

function keptOf(before: GoalClockEntry | undefined): Pick<GoalClockEntry, 'latest_opened' | 'last_summary'> {
  if (before === undefined) {
    return {};
  }
  return {
    ...(before.latest_opened === undefined ? {} : { latest_opened: before.latest_opened }),
    ...(before.last_summary === undefined ? {} : { last_summary: before.last_summary }),
  };
}

function clockOfGoal(goal: Goal, before: GoalClockEntry | undefined, savedAt: Instant): GoalClockEntry {
  const calendar = calendarOf(goal);
  return {
    first_saved_at: before?.first_saved_at ?? savedAt,
    ...(goal.retired === undefined ? {} : { retired: goal.retired }),
    ...(calendar === undefined ? {} : { calendar }),
    ...summaryOf(goal),
    ...keptOf(before),
  };
}

function savedAfter(clock: GoalClockEntry | undefined, event: RecordedGoalEvent): GoalClockEntry | undefined {
  if (event.type === 'goal_created') {
    return clockOfGoal(event.data.goal, undefined, Date.parse(event.context.at));
  }
  if (clock === undefined || clock.removed === true) {
    return undefined;
  }
  if (event.type === 'goal_updated') {
    return clockOfGoal(event.data.goal, clock, Date.parse(event.context.at));
  }
  return event.type === 'goal_removed' ? { ...clock, removed: true } : undefined;
}

function openedAfter(clock: GoalClockEntry, opens: Instant): GoalClockEntry | undefined {
  return clock.calendar !== undefined && (clock.latest_opened ?? -Infinity) < opens
    ? { ...clock, latest_opened: opens }
    : undefined;
}

function summarisedAfter(clock: GoalClockEntry, due: Instant): GoalClockEntry | undefined {
  return (clock.last_summary ?? -Infinity) < due ? { ...clock, last_summary: due } : undefined;
}

interface ClockMoved {
  readonly clock: GoalClockEntry | undefined;
  readonly opens?: Instant;
}

function resultsAfter(clock: GoalClockEntry, message: ProjectedMessage): ClockMoved {
  const opened = openedEventOf(message);
  if (Option.isSome(opened) && opened.value.data.window !== undefined) {
    const opens = Date.parse(opened.value.data.window.opens);
    return { clock: openedAfter(clock, opens), opens };
  }
  const summarised = summaryStartOf(message);
  return {
    clock: Option.isSome(summarised) ? summarisedAfter(clock, Date.parse(summarised.value.data.due)) : undefined,
  };
}

function isRunning(clock: GoalClockEntry): boolean {
  return clock.retired !== true && clock.removed !== true;
}

export function nextOpeningOf(clock: GoalClockEntry): Instant | null {
  if (!isRunning(clock) || clock.calendar === undefined) {
    return null;
  }
  return nextCalendarOpeningOf(clock.calendar, {
    firstSavedAt: clock.first_saved_at,
    ...(clock.latest_opened === undefined ? {} : { latestOpened: clock.latest_opened }),
  });
}

export function nextSummaryOf(clock: GoalClockEntry): Instant | null {
  const { summary } = clock;
  if (!isRunning(clock) || summary === undefined) {
    return null;
  }
  const after = clock.last_summary ?? clock.first_saved_at;
  return Result.getOrElse(
    windowOpeningAfter(
      {
        kind: 'cron',
        expression: summary.cron,
        ...(summary.time_zone === undefined ? {} : { time_zone: summary.time_zone }),
      },
      clock.first_saved_at,
      after,
    ),
    () => null,
  );
}

function earliestOf(times: readonly (Instant | null)[]): Instant | null {
  const set = times.filter((time) => time !== null);
  return set.length === 0 ? null : Math.min(...set);
}

function versionAfter(row: ProjectedRow | undefined, event: RecordedGoalEvent): number {
  const held = Number(row?.['goal_version'] ?? 0);
  if (event.type === 'goal_created') {
    return 1;
  }
  return event.type === 'goal_updated' ? held + 1 : held;
}

function duesOf(clock: GoalClockEntry, held: Instant | null): ProjectedRow {
  return {
    clock: textOfClock(clock),
    opens_at: clock.removed === true ? null : earliestOf([nextOpeningOf(clock), held]),
    summary_at: nextSummaryOf(clock),
  };
}

function retiringOf(clock: GoalClockEntry, event: RecordedGoalEvent): Instant | null {
  return clock.retired === true && clock.removed !== true ? Date.parse(event.context.at) : null;
}

function heldBeyond(row: ProjectedRow, opens: Instant | undefined): Instant | null {
  const held = row['opens_at'];
  return typeof held === 'number' && held !== opens ? held : null;
}

function resultsRowOf(row: ProjectedRow, before: GoalClockEntry, message: ProjectedMessage): ProjectedRow | undefined {
  const moved = resultsAfter(before, message);
  return moved.clock === undefined ? undefined : { ...row, ...duesOf(moved.clock, heldBeyond(row, moved.opens)) };
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const before = goalClockIn(row);
  return Option.match(goalEventOf(message), {
    onSome: (event) => {
      const clock = savedAfter(before, event);
      return clock === undefined
        ? undefined
        : { goal_version: versionAfter(row, event), ...duesOf(clock, retiringOf(clock, event)) };
    },
    onNone: () => (row === undefined || before === undefined ? undefined : resultsRowOf(row, before, message)),
  });
}

const goalClockTypes = [
  'goal_created',
  'goal_updated',
  'goal_removed',
  'goal_assessment_opened',
  'goal_summary_started',
];

function keyOf({ type }: ProjectedMessage): string | undefined {
  return goalClockTypes.includes(type) ? clockKey : undefined;
}

export const clockRows: KeyedProjection = {
  name: clocksName,
  version: 2,
  scopes: ['definition'],
  kinds: [goalsKind, assessmentsKind, goalSummariesKind],
  types: goalClockTypes,
  columns: [
    { name: 'clock', kind: 'text' },
    { name: 'goal_version', kind: 'integer' },
    { name: 'opens_at', kind: 'integer' },
    { name: 'summary_at', kind: 'integer' },
  ],
  indexes: [
    { name: 'opens_due', columns: ['opens_at'], acrossPlaybooks: true, whereSet: 'opens_at' },
    { name: 'summary_due', columns: ['summary_at'], acrossPlaybooks: true, whereSet: 'summary_at' },
  ],
  keyOf,
  advanced: [
    { column: 'opens_at', setBy: ['goal_created', 'goal_updated', 'goal_removed', 'goal_assessment_opened'] },
    { column: 'summary_at', setBy: ['goal_created', 'goal_updated', 'goal_removed', 'goal_summary_started'] },
  ],
  rowAfter,
};
