import { agentIssue, type Goal, type GoalIssue, type Goals } from '@on.auto/definitions/goals';
import { cronRejectionOf, isKnownTimeZone } from '@on.auto/workflow-host';
import { Result } from 'effect';

import { windowOpeningAfter, type WindowTiming } from '../windows/window-times.ts';
import { exactDurationOf, isWithinTheDurations } from './exact-durations.ts';

const anHour = 3_600_000;

export const summaryTimesChecked = 25;

interface Placed {
  readonly goal: Goal;
  readonly pointer: string;
  readonly name: string;
}

function durationIssuesOf(pointer: string, what: string, text: string | undefined): readonly GoalIssue[] {
  if (text === undefined) {
    return [];
  }
  const milliseconds = exactDurationOf(text);
  if (milliseconds === undefined) {
    return [
      agentIssue(pointer, `${what} is no exact length: write weeks, days, hours and minutes, such as P7D or PT12H`),
    ];
  }
  return isWithinTheDurations(milliseconds)
    ? []
    : [agentIssue(pointer, `${what} lasts from a minute to 90 days, not ${text}`)];
}

function zoneIssuesOf(pointer: string, what: string, zone: string | undefined): readonly GoalIssue[] {
  return zone === undefined || isKnownTimeZone(zone)
    ? []
    : [
        agentIssue(
          pointer,
          `${what} is no time zone name this runtime knows; name one from the time zone database, or leave it out for UTC`,
        ),
      ];
}

function windowIssuesOf({ goal: { window }, pointer, name }: Placed): readonly GoalIssue[] {
  if (window === undefined) {
    return [];
  }
  const at = `${pointer}/window`;
  const grace = durationIssuesOf(`${at}/grace`, `The grace of ${name}`, window.grace);
  return 'calendar' in window
    ? [...grace, ...zoneIssuesOf(`${at}/time_zone`, `The time zone of ${name}`, window.time_zone)]
    : [...durationIssuesOf(`${at}/for`, `How long ${name} runs`, window.for), ...grace];
}

function nextAfter(timing: WindowTiming, moment: number): number | null {
  return Result.getOrElse(windowOpeningAfter(timing, moment), () => null);
}

function tooSoon(timing: WindowTiming, after: number, previous: number | undefined, left: number): boolean {
  const next = left === 0 ? null : nextAfter(timing, after);
  if (next === null) {
    return false;
  }
  return (previous !== undefined && next - previous < anHour) || tooSoon(timing, next, next, left - 1);
}

export function comesRoundTooOften(timing: WindowTiming, at: number): boolean {
  return tooSoon(timing, at, undefined, summaryTimesChecked);
}

function summaryIssuesOf({ goal: { notify }, pointer, name }: Placed, at: number): readonly GoalIssue[] {
  const summary = notify?.summary;
  if (summary === undefined) {
    return [];
  }
  const where = `${pointer}/notify/summary`;
  const what = `The summary of ${name}`;
  if (cronRejectionOf(summary.cron) !== undefined) {
    return [
      agentIssue(
        `${where}/cron`,
        `${what} has a schedule that is not a valid cron expression: five fields, minute, hour, day of month, month and day of week`,
      ),
    ];
  }
  const zone = zoneIssuesOf(`${where}/time_zone`, `The time zone of the summary of ${name}`, summary.time_zone);
  if (zone.length > 0) {
    return zone;
  }
  const timing: WindowTiming = {
    kind: 'cron',
    expression: summary.cron,
    ...(summary.time_zone === undefined ? {} : { time_zone: summary.time_zone }),
  };
  return comesRoundTooOften(timing, at)
    ? [
        agentIssue(
          `${where}/cron`,
          `${what} would come more often than once an hour; give it times an hour or more apart`,
        ),
      ]
    : [];
}

export function timingIssuesOf(at: number): (goals: Goals) => readonly GoalIssue[] {
  return (goals) =>
    goals.flatMap((goal, index) => {
      const placed: Placed = { goal, pointer: `/${String(index)}`, name: `the goal ${goal.id}` };
      return [...windowIssuesOf(placed), ...summaryIssuesOf(placed, at)];
    });
}
