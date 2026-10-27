import { timeZoneOf, type CronTrigger, type ScheduleTrigger } from '@on.auto/definitions';
import { Cron } from 'croner';
import { Result } from 'effect';

import type { InZone, ZoneClock } from './zone-clock.ts';

const fieldsOfACron = 5;

const aSecond = 1000;

export interface DueMoments {
  readonly anchor: number;
  readonly due: number;
  readonly now: number;
}

export interface DueTimes {
  readonly latest: number;
  readonly next: number | null;
}

interface ZonedCron {
  readonly clock: ZoneClock;
  readonly wallClockAfter: (wallClock: number) => number | undefined;
  readonly wallClocksBy: (wallClock: number) => readonly number[];
}

interface Walk {
  readonly passed: number;
  readonly next: number | null;
}

function messageOf(error: unknown): string {
  return String(error).replace(/^\w*Error: /u, '');
}

function cronOf(expression: string): Cron {
  return new Cron(expression, { timezone: 'UTC', mode: '5-part', domAndDow: false, paused: true });
}

export function cronRejectionOf(expression: string): string | undefined {
  if (expression.trim().split(/\s+/u).length !== fieldsOfACron) {
    return `A cron expression has five fields, minute, hour, day of month, month and day of week, not ${JSON.stringify(expression)}`;
  }
  try {
    return cronOf(expression).nextRun() === null
      ? `The cron expression ${expression} names no time that comes`
      : undefined;
  } catch (error) {
    return `The cron expression ${expression} cannot be read: ${messageOf(error)}`;
  }
}

function zonedCronOf(trigger: CronTrigger, inZone: InZone): ZonedCron {
  const cron = cronOf(trigger.expression);
  return {
    clock: inZone(timeZoneOf(trigger)),
    wallClockAfter: (wallClock) => cron.nextRun(new Date(wallClock))?.getTime(),
    wallClocksBy: (wallClock) => cron.previousRuns(1, new Date(wallClock + aSecond)).map((run) => run.getTime()),
  };
}

function walkedPast(zoned: ZonedCron, moment: number, passed: number): Walk {
  const wallClock = zoned.wallClockAfter(passed);
  if (wallClock === undefined) {
    return { passed, next: null };
  }
  const due = zoned.clock.firstInstantReaching(wallClock);
  return due > moment ? { passed, next: due } : walkedPast(zoned, moment, wallClock);
}

function walkedFrom(zoned: ZonedCron, moment: number): Walk {
  return walkedPast(zoned, moment, zoned.clock.wallClockAt(moment));
}

function periodTimes(milliseconds: number, { anchor, now }: DueMoments): DueTimes {
  const periods = Math.floor((now - anchor) / milliseconds);
  return { latest: anchor + periods * milliseconds, next: anchor + (periods + 1) * milliseconds };
}

function cronTimes(zoned: ZonedCron, { due, now }: DueMoments): DueTimes {
  const { passed, next } = walkedFrom(zoned, now);
  const latest = zoned.wallClocksBy(passed).map((wallClock) => zoned.clock.firstInstantReaching(wallClock));
  return { latest: Math.max(due, ...latest), next };
}

function computed<Value>(compute: () => Value): Result.Result<Value, string> {
  return Result.try({ try: compute, catch: messageOf });
}

export function firstDueOf(
  timing: ScheduleTrigger,
  anchor: number,
  inZone: InZone,
): Result.Result<number | null, string> {
  return computed(() =>
    timing.kind === 'every'
      ? periodTimes(timing.milliseconds, { anchor, due: anchor, now: anchor }).next
      : walkedFrom(zonedCronOf(timing, inZone), anchor).next,
  );
}

export function dueTimesOf(
  timing: ScheduleTrigger,
  moments: DueMoments,
  inZone: InZone,
): Result.Result<DueTimes, string> {
  return computed(() =>
    timing.kind === 'every'
      ? periodTimes(timing.milliseconds, moments)
      : cronTimes(zonedCronOf(timing, inZone), moments),
  );
}
