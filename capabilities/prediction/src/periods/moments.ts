import { civilOfDay, civilDay, daysInMonth, millisecondsInADay } from './civil-days.ts';
import { periodOfDay, type Grain } from './grains.ts';

const written =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?)?(?:[Zz]|(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))$/u;

type Parts = Readonly<Record<string, string | undefined>>;

const millisecondsIn = { hour: 3_600_000, minute: 60_000, second: 1000 } as const;

const lastYear = 9999;

function numberOf(parts: Parts, name: string): number {
  return Number(parts[name] ?? 0);
}

function offsetOf(parts: Parts): number | undefined {
  const hours = numberOf(parts, 'hours');
  const minutes = numberOf(parts, 'minutes');
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  return (parts['sign'] === '-' ? -1 : 1) * (hours * millisecondsIn.hour + minutes * millisecondsIn.minute);
}

function isOnTheClock(parts: Parts): boolean {
  return numberOf(parts, 'hour') <= 23 && numberOf(parts, 'minute') <= 59 && numberOf(parts, 'second') <= 59;
}

function isInTheCalendar(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function withinTheYears(moment: number): number | undefined {
  const { year } = civilOfDay(Math.floor(moment / millisecondsInADay));
  return year >= 0 && year <= lastYear ? moment : undefined;
}

export function momentOf(text: string): number | undefined {
  const parts = written.exec(text)?.groups;
  if (parts === undefined) {
    return undefined;
  }
  const year = numberOf(parts, 'year');
  const month = numberOf(parts, 'month');
  const day = numberOf(parts, 'day');
  const offset = offsetOf(parts);
  if (offset === undefined || !isInTheCalendar(year, month, day) || !isOnTheClock(parts)) {
    return undefined;
  }
  const fraction = Math.floor(Number(`0.${parts['fraction'] ?? '0'}`) * millisecondsIn.second);
  const sinceMidnight =
    numberOf(parts, 'hour') * millisecondsIn.hour +
    numberOf(parts, 'minute') * millisecondsIn.minute +
    numberOf(parts, 'second') * millisecondsIn.second +
    fraction;
  return withinTheYears(civilDay({ year, month, day }) * millisecondsInADay + sinceMidnight - offset);
}

export function periodOfMoment(grain: Grain, moment: number): number {
  return periodOfDay(grain, Math.floor(moment / millisecondsInADay));
}
