import { GoalsEventSchema, WeekdaySchema, type Goal, type RecordedGoalsEvent } from '@on.auto/definitions/goals';
import { recordedDecoder, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import { Option, Result, Schema } from 'effect';

import { summaryRunIdOf } from '../assessments/assessment-identity.ts';
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

const definitionsKind = 'definitions';

const contributionTypes = ['definition_created', 'definition_updated', 'definition_resumed', 'definition_restored'];

export const clockKey = 'clock';

const CalendarSchema = Schema.Struct({
  calendar: Schema.Literals(['day', 'week', 'month']),
  time_zone: Schema.optionalKey(Schema.String),
  grace: Schema.optionalKey(Schema.String),
  days: Schema.optionalKey(Schema.Array(WeekdaySchema)),
});

const GoalClockSchema = Schema.Struct({
  id: Schema.String,
  first_saved_at: Schema.Finite,
  retired: Schema.optionalKey(Schema.Boolean),
  calendar: Schema.optionalKey(CalendarSchema),
  summary: Schema.optionalKey(Schema.Struct({ cron: Schema.String, time_zone: Schema.optionalKey(Schema.String) })),
  latest_opened: Schema.optionalKey(Schema.Finite),
  last_summary: Schema.optionalKey(Schema.Finite),
  armed_at: Schema.optionalKey(Schema.Finite),
});

const GoalClocksSchema = Schema.fromJsonString(Schema.Array(GoalClockSchema));

export type GoalClockEntry = typeof GoalClockSchema.Type;

const clocksOfText = Schema.decodeUnknownOption(GoalClocksSchema);

const textOfClocks = Schema.encodeSync(GoalClocksSchema);

export function goalClocksIn(row: ProjectedRow | undefined): readonly GoalClockEntry[] {
  return Option.getOrElse(clocksOfText(row?.['goals']), () => []);
}

const goalsEventOf = recordedDecoder(GoalsEventSchema);

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

function keptOf(
  before: GoalClockEntry | undefined,
): Pick<GoalClockEntry, 'latest_opened' | 'last_summary' | 'armed_at'> {
  if (before === undefined) {
    return {};
  }
  return {
    ...(before.latest_opened === undefined ? {} : { latest_opened: before.latest_opened }),
    ...(before.last_summary === undefined ? {} : { last_summary: before.last_summary }),
    ...(before.armed_at === undefined ? {} : { armed_at: before.armed_at }),
  };
}

function clockOfGoal(goal: Goal, before: GoalClockEntry | undefined, savedAt: Instant): GoalClockEntry {
  const calendar = calendarOf(goal);
  return {
    id: goal.id,
    first_saved_at: before?.first_saved_at ?? savedAt,
    ...(goal.retired === undefined ? {} : { retired: goal.retired }),
    ...(calendar === undefined ? {} : { calendar }),
    ...summaryOf(goal),
    ...keptOf(before),
  };
}

function savedAfter(clocks: readonly GoalClockEntry[], event: RecordedGoalsEvent): readonly GoalClockEntry[] {
  const savedAt = Date.parse(event.context.at);
  return event.data.goals.map((goal) =>
    clockOfGoal(
      goal,
      clocks.find(({ id }) => id === goal.id),
      savedAt,
    ),
  );
}

function changedOf(
  clocks: readonly GoalClockEntry[],
  moved: (clock: GoalClockEntry) => GoalClockEntry | undefined,
): readonly GoalClockEntry[] {
  const after = clocks.map((clock) => moved(clock) ?? clock);
  return after.some((clock, index) => clock !== clocks[index]) ? after : clocks;
}

function openedAfter(clocks: readonly GoalClockEntry[], goal: string, opens: Instant): readonly GoalClockEntry[] {
  return changedOf(clocks, (clock) =>
    clock.id === goal && clock.calendar !== undefined && (clock.latest_opened ?? -Infinity) < opens
      ? { ...clock, latest_opened: opens }
      : undefined,
  );
}

function summarisedAfter(clocks: readonly GoalClockEntry[], due: Instant, run: string): readonly GoalClockEntry[] {
  return changedOf(clocks, (clock) =>
    summaryRunIdOf(clock.id, due) === run && (clock.last_summary ?? -Infinity) < due
      ? { ...clock, last_summary: due }
      : undefined,
  );
}

interface ClocksMoved {
  readonly clocks: readonly GoalClockEntry[];
  readonly opens?: Instant;
}

function clocksAfter(clocks: readonly GoalClockEntry[], message: ProjectedMessage): ClocksMoved {
  const opened = openedEventOf(message);
  if (Option.isSome(opened) && opened.value.data.window !== undefined) {
    const opens = Date.parse(opened.value.data.window.opens);
    return { clocks: openedAfter(clocks, opened.value.data.goal, opens), opens };
  }
  const summarised = summaryStartOf(message);
  return {
    clocks: Option.isSome(summarised)
      ? summarisedAfter(clocks, Date.parse(summarised.value.data.due), summarised.value.data.run)
      : clocks,
  };
}

function dueBeyond(row: ProjectedRow, opens: Instant | undefined): Instant | null {
  const held = row['opens_at'];
  return typeof held === 'number' && held !== opens ? held : null;
}

export function nextOpeningOf(clock: GoalClockEntry): Instant | null {
  if (clock.retired === true || clock.calendar === undefined) {
    return null;
  }
  return nextCalendarOpeningOf(clock.calendar, {
    firstSavedAt: clock.first_saved_at,
    ...(clock.latest_opened === undefined ? {} : { latestOpened: clock.latest_opened }),
  });
}

export function nextSummaryOf(clock: GoalClockEntry): Instant | null {
  const { summary } = clock;
  if (clock.retired === true || summary === undefined) {
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

function retiringOf(clocks: readonly GoalClockEntry[], savedAt: Instant): ProjectedRow {
  return clocks.some(({ retired }) => retired === true) ? { opens_at: savedAt } : {};
}

function duesOf(clocks: readonly GoalClockEntry[], held: Instant | null = null): ProjectedRow {
  return {
    goals: textOfClocks(clocks),
    opens_at: earliestOf([...clocks.map((clock) => nextOpeningOf(clock)), held]),
    summary_at: earliestOf(clocks.map((clock) => nextSummaryOf(clock))),
  };
}

function armedCalendarOf(clock: GoalClockEntry): CalendarWindowRule | undefined {
  return clock.retired === true ? undefined : clock.calendar;
}

function armedBy(row: ProjectedRow | undefined, { context }: ProjectedMessage): ProjectedRow | undefined {
  const clocks = goalClocksIn(row);
  if (row === undefined || !clocks.some((clock) => armedCalendarOf(clock) !== undefined)) {
    return undefined;
  }
  const at = Date.parse(context.at);
  const armed = clocks.map((clock) => (armedCalendarOf(clock) === undefined ? clock : { ...clock, armed_at: at }));
  const next = clocks.map((clock) => {
    const calendar = armedCalendarOf(clock);
    return calendar === undefined ? null : nextCalendarOpeningOf(calendar, { firstSavedAt: at });
  });
  const held = row['opens_at'];
  return {
    ...row,
    goals: textOfClocks(armed),
    opens_at: earliestOf([...next, typeof held === 'number' ? held : null]),
  };
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  if (contributionTypes.includes(message.type)) {
    return armedBy(row, message);
  }
  return Option.match(goalsEventOf(message), {
    onSome: (event) => {
      const clocks = savedAfter(goalClocksIn(row), event);
      return {
        goals_version: event.data.version,
        ...duesOf(clocks),
        ...retiringOf(clocks, Date.parse(event.context.at)),
      };
    },
    onNone: () => {
      const clocks = goalClocksIn(row);
      const after = clocksAfter(clocks, message);
      return row === undefined || after.clocks === clocks
        ? undefined
        : { ...row, ...duesOf(after.clocks, dueBeyond(row, after.opens)) };
    },
  });
}

const goalClockTypes = ['playbook_goals_saved', 'goal_assessment_opened', 'goal_summary_started'];

const clockTypes = [...goalClockTypes, ...contributionTypes];

function keyOf({ type, context }: ProjectedMessage): string | undefined {
  if (contributionTypes.includes(type)) {
    return context.definitionType === 'workflow' ? clockKey : undefined;
  }
  return goalClockTypes.includes(type) ? clockKey : undefined;
}

export const clockRows: KeyedProjection = {
  name: clocksName,
  version: 1,
  kinds: [goalsKind, assessmentsKind, goalSummariesKind, definitionsKind],
  types: clockTypes,
  columns: [
    { name: 'goals_version', kind: 'integer' },
    { name: 'goals', kind: 'text' },
    { name: 'opens_at', kind: 'integer' },
    { name: 'summary_at', kind: 'integer' },
  ],
  indexes: [
    { name: 'opens_due', columns: ['opens_at'], acrossPlaybooks: true, whereSet: 'opens_at' },
    { name: 'summary_due', columns: ['summary_at'], acrossPlaybooks: true, whereSet: 'summary_at' },
  ],
  keyOf,
  advanced: [
    { column: 'opens_at', setBy: ['playbook_goals_saved', 'goal_assessment_opened', ...contributionTypes] },
    { column: 'summary_at', setBy: ['playbook_goals_saved', 'goal_summary_started'] },
  ],
  rowAfter,
};
