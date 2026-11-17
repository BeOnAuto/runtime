import { zoneClockIn } from '../goal-windows/calendar-windows.ts';
import { aDay } from '../goal-windows/goal-durations.ts';

export interface ZoneDay {
  readonly day: string;
  readonly start: number;
  readonly end: number;
}

function dayTextOf(wallClock: number): string {
  return new Date(wallClock).toISOString().slice(0, 10);
}

export function dayHolding(timeZone: string, instant: number): string {
  return dayTextOf(zoneClockIn(timeZone).wallClockAt(instant));
}

export function zoneDayOf(timeZone: string, day: string): ZoneDay {
  const clock = zoneClockIn(timeZone);
  const midnight = Date.parse(`${day}T00:00:00.000Z`);
  return { day, start: clock.firstInstantReaching(midnight), end: clock.firstInstantReaching(midnight + aDay) };
}

export function zoneDaysBack(timeZone: string, until: string, count: number): readonly ZoneDay[] {
  const midnight = Date.parse(`${until}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, back) => zoneDayOf(timeZone, dayTextOf(midnight - back * aDay)));
}
