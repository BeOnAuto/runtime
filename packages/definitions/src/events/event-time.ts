const rfc3339 =
  /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])[Tt](?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d|60)(?:\.(?<fraction>\d{1,9}))?(?:[Zz]|(?<sign>[+-])(?<offsetHour>[01]\d|2[0-3]):(?<offsetMinute>[0-5]\d))$/u;

const minutesInADay = 1440;

const lastMinuteOfADay = minutesInADay - 1;

const leapSecond = 60;

const nanosecondDigits = 9;

interface TimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string;
  readonly offsetMinutes: number;
}

function partsOf(written: string): TimeParts | undefined {
  const groups = rfc3339.exec(written)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const numberOf = (name: string): number => Number(groups[name] ?? '0');
  const offset = numberOf('offsetHour') * 60 + numberOf('offsetMinute');
  return {
    year: numberOf('year'),
    month: numberOf('month'),
    day: numberOf('day'),
    hour: numberOf('hour'),
    minute: numberOf('minute'),
    second: numberOf('second'),
    fraction: groups['fraction'] ?? '',
    offsetMinutes: groups['sign'] === '-' ? -offset : offset,
  };
}

function dayExists({ year, month, day }: TimeParts): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCDate() === day;
}

function utcMinuteOfTheDay({ hour, minute, offsetMinutes }: TimeParts): number {
  return (((hour * 60 + minute - offsetMinutes) % minutesInADay) + minutesInADay) % minutesInADay;
}

function leapSecondEndsADay(parts: TimeParts): boolean {
  return parts.second !== leapSecond || utcMinuteOfTheDay(parts) === lastMinuteOfADay;
}

export function isTime(written: string): boolean {
  const parts = partsOf(written);
  return parts !== undefined && dayExists(parts) && leapSecondEndsADay(parts);
}

function secondsSinceTheEpoch({ year, month, day, hour, minute, second, offsetMinutes }: TimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute - offsetMinutes);
  return date.getTime() / 1000 + second;
}

export function instantOf(written: string): string {
  const parts = partsOf(written);
  return parts === undefined
    ? written
    : `${secondsSinceTheEpoch(parts)}.${parts.fraction.padEnd(nanosecondDigits, '0')}`;
}
