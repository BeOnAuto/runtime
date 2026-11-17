import { isCalendarDay } from '@on.auto/operations';
import { isKnownTimeZone } from '@on.auto/workflow-host';
import { Schema } from 'effect';

export const TimeZoneSchema = Schema.String.check(
  Schema.makeFilter(isKnownTimeZone, { expected: 'an IANA time zone, such as America/Los_Angeles' }),
);

export const DaySchema = Schema.String.check(
  Schema.makeFilter(isCalendarDay, { expected: 'a day, such as 2026-11-16' }),
);
