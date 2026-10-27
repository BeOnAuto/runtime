import type { ScheduleTrigger } from '@on.auto/definitions';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { cronRejectionOf, dueTimesOf, firstDueOf, type DueTimes } from './schedule-times.ts';
import { zoneClockOf } from './zone-clock.ts';

const anchor = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

function at(text: string): number {
  return Date.parse(text);
}

function cron(expression: string, timeZone?: string): ScheduleTrigger {
  return {
    kind: 'cron',
    reference: '/schedule/cron',
    expression,
    ...(timeZone === undefined ? {} : { time_zone: timeZone }),
  };
}

const every: ScheduleTrigger = { kind: 'every', reference: '/schedule/every', milliseconds: aMinute };

function dueTimesAt(trigger: ScheduleTrigger, due: number, now: number): DueTimes {
  return Result.getOrThrow(dueTimesOf(trigger, { anchor, due, now }, zoneClockOf));
}

function dueTimesFrom(trigger: ScheduleTrigger, from: string, count: number): readonly string[] {
  return Array.from({ length: count }).reduce<readonly string[]>((times) => {
    const now = at(times.at(-1) ?? from);
    const { next } = dueTimesAt(trigger, now, now);
    return next === null ? times : [...times, new Date(next).toISOString()];
  }, []);
}

describe('a cron expression', () => {
  it('has five fields that can be read and name a time that comes', () => {
    expect([
      cronRejectionOf('30 2 * * *'),
      cronRejectionOf('30 2 * *'),
      cronRejectionOf('0 30 2 * * *'),
      cronRejectionOf('61 2 * * *'),
      cronRejectionOf('0 0 30 2 *'),
    ]).toEqual([
      undefined,
      'A cron expression has five fields, minute, hour, day of month, month and day of week, not "30 2 * *"',
      'A cron expression has five fields, minute, hour, day of month, month and day of week, not "0 30 2 * * *"',
      'The cron expression 61 2 * * * cannot be read: CronPattern: Invalid value for minute: 61',
      'The cron expression 0 0 30 2 * names no time that comes',
    ]);
  });
});

describe('the first time a schedule is due', () => {
  it('is a period after its activation, or the first time its cron names after it, in UTC', () => {
    expect([
      firstDueOf(every, anchor, zoneClockOf),
      firstDueOf(cron('30 2 * * *'), anchor, zoneClockOf),
      firstDueOf(cron('0 0 30 2 *'), anchor, zoneClockOf),
    ]).toEqual([
      Result.succeed(anchor + aMinute),
      Result.succeed(at('2026-10-02T02:30:00.000Z')),
      Result.succeed(null),
    ]);
  });

  it('cannot be computed for a time zone the platform does not know, or an expression it cannot read', () => {
    expect([
      firstDueOf(cron('30 2 * * *', 'Mars/Olympus'), anchor, zoneClockOf),
      dueTimesOf(cron('61 2 * * *'), { anchor, due: anchor, now: anchor }, zoneClockOf),
    ]).toEqual([
      Result.fail('Invalid time zone specified: Mars/Olympus'),
      Result.fail('CronPattern: Invalid value for minute: 61'),
    ]);
  });
});

describe('the times a schedule is due', () => {
  it('are the latest at or before now and the next after it: of a period from its activation, or of its cron in UTC', () => {
    const nightly = cron('30 2 * * *');
    const due = at('2026-10-02T02:30:00.000Z');

    expect([
      dueTimesAt(every, anchor + aMinute, anchor + 5 * aMinute + 10_000),
      dueTimesAt(nightly, due, due),
      dueTimesAt(nightly, due, at('2026-10-05T12:00:00.000Z')),
      dueTimesAt(nightly, due, at('2026-10-05T02:29:59.999Z')),
    ]).toEqual([
      { latest: anchor + 5 * aMinute, next: anchor + 6 * aMinute },
      { latest: due, next: at('2026-10-03T02:30:00.000Z') },
      { latest: at('2026-10-05T02:30:00.000Z'), next: at('2026-10-06T02:30:00.000Z') },
      { latest: at('2026-10-04T02:30:00.000Z'), next: at('2026-10-05T02:30:00.000Z') },
    ]);
  });
});

describe('the times of a cron schedule in a time zone', () => {
  it('are the times its clocks show, an hour apart in UTC across the spring and autumn changes', () => {
    expect([
      dueTimesFrom(cron('0 6 * * *', 'America/New_York'), '2026-03-06T12:00:00.000Z', 3),
      dueTimesFrom(cron('0 6 * * *', 'America/New_York'), '2026-10-30T12:00:00.000Z', 3),
    ]).toEqual([
      ['2026-03-07T11:00:00.000Z', '2026-03-08T10:00:00.000Z', '2026-03-09T10:00:00.000Z'],
      ['2026-10-31T10:00:00.000Z', '2026-11-01T11:00:00.000Z', '2026-11-02T11:00:00.000Z'],
    ]);
  });

  it('that the clocks skip are due once, at the first instant after the skipped hour', () => {
    expect([
      dueTimesFrom(cron('30 2 * * *', 'America/New_York'), '2026-03-07T12:00:00.000Z', 2),
      dueTimesFrom(cron('*/15 2,3 * * *', 'America/New_York'), '2026-03-08T06:00:00.000Z', 5),
    ]).toEqual([
      ['2026-03-08T07:00:00.000Z', '2026-03-09T06:30:00.000Z'],
      [
        '2026-03-08T07:00:00.000Z',
        '2026-03-08T07:15:00.000Z',
        '2026-03-08T07:30:00.000Z',
        '2026-03-08T07:45:00.000Z',
        '2026-03-09T06:00:00.000Z',
      ],
    ]);
  });

  it('that the clocks show twice are due once, at the first, in a repeated hour and a repeated half-hour', () => {
    expect([
      dueTimesFrom(cron('30 1 * * *', 'America/New_York'), '2026-10-31T12:00:00.000Z', 2),
      dueTimesFrom(cron('*/30 * * * *', 'America/New_York'), '2026-11-01T04:40:00.000Z', 4),
      dueTimesFrom(cron('*/30 * * * *', 'America/New_York'), '2026-11-01T06:10:00.000Z', 1),
      dueTimesFrom(cron('*/15 1 * * *', 'Australia/Lord_Howe'), '2026-04-04T13:00:00.000Z', 5),
    ]).toEqual([
      ['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'],
      ['2026-11-01T05:00:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-01T07:00:00.000Z', '2026-11-01T07:30:00.000Z'],
      ['2026-11-01T07:00:00.000Z'],
      [
        '2026-04-04T14:00:00.000Z',
        '2026-04-04T14:15:00.000Z',
        '2026-04-04T14:30:00.000Z',
        '2026-04-04T14:45:00.000Z',
        '2026-04-05T14:30:00.000Z',
      ],
    ]);
  });
});

describe('the latest time a cron schedule in a time zone was due', () => {
  it('is the last time its clocks showed, the first of a time they showed twice', () => {
    const morning = cron('0 6 * * *', 'America/New_York');
    const late = cron('30 1 * * *', 'America/New_York');

    expect([
      dueTimesAt(morning, at('2026-03-07T11:00:00.000Z'), at('2026-03-09T12:00:00.000Z')).latest,
      dueTimesAt(morning, at('2026-03-07T11:00:00.000Z'), at('2026-03-08T10:00:00.000Z')).latest,
      dueTimesAt(late, at('2026-10-31T05:30:00.000Z'), at('2026-11-01T06:45:00.000Z')),
      dueTimesAt(late, at('2026-10-31T05:30:00.000Z'), at('2026-11-01T06:15:00.000Z')),
    ]).toEqual([
      at('2026-03-09T10:00:00.000Z'),
      at('2026-03-08T10:00:00.000Z'),
      { latest: at('2026-11-01T05:30:00.000Z'), next: at('2026-11-02T06:30:00.000Z') },
      { latest: at('2026-11-01T05:30:00.000Z'), next: at('2026-11-02T06:30:00.000Z') },
    ]);
  });
});
