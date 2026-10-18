interface StringFormat {
  readonly example: string;
  readonly holds: (text: string) => boolean;
}

interface Clock {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly offsetHours: number;
  readonly offsetMinutes: number;
  readonly minutesEastOfUtc: number;
}

const dateParts = String.raw`(\d{4})-(\d{2})-(\d{2})`;

const timeParts = String.raw`(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))`;

const fullDate = new RegExp(`^${dateParts}$`, 'u');

const fullTime = new RegExp(`^${timeParts}$`, 'u');

const dateAndTime = new RegExp(`^${dateParts}[Tt]${timeParts}$`, 'u');

const emailAddress =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/u;

const uriCharacters = /^(?:[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=-]|%[\dA-Fa-f]{2})+$/u;

const uuidForm = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

const daysOfMonths: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const minutesOfADay = 24 * 60;

const lastMinuteOfADay = minutesOfADay - 1;

const leapSecond = 60;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysOf(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (daysOfMonths[month - 1] ?? 0);
}

function holdsADay([year, month, day]: readonly string[]): boolean {
  return Number(day) >= 1 && Number(day) <= daysOf(Number(year), Number(month));
}

function clockOf([hour, minute, second, sign = '+', offsetHours = '0', offsetMinutes = '0']: readonly string[]): Clock {
  const offset = Number(offsetHours) * 60 + Number(offsetMinutes);
  return {
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    offsetHours: Number(offsetHours),
    offsetMinutes: Number(offsetMinutes),
    minutesEastOfUtc: sign === '-' ? -offset : offset,
  };
}

function isTheLastMinuteInUtc({ hour, minute, minutesEastOfUtc }: Clock): boolean {
  const minuteInUtc = (hour * 60 + minute - minutesEastOfUtc + minutesOfADay) % minutesOfADay;
  return minuteInUtc === lastMinuteOfADay;
}

function holdsAClock(parts: readonly string[]): boolean {
  const clock = clockOf(parts);
  const { hour, minute, second, offsetHours, offsetMinutes } = clock;
  const inTheMinute = second < leapSecond || (second === leapSecond && isTheLastMinuteInUtc(clock));
  return hour <= 23 && minute <= 59 && inTheMinute && offsetHours <= 23 && offsetMinutes <= 59;
}

function isFullDate(text: string): boolean {
  const parts = fullDate.exec(text)?.slice(1);
  return parts !== undefined && holdsADay(parts);
}

function isFullTime(text: string): boolean {
  const parts = fullTime.exec(text)?.slice(1);
  return parts !== undefined && holdsAClock(parts);
}

function isDateAndTime(text: string): boolean {
  const parts = dateAndTime.exec(text)?.slice(1);
  return parts !== undefined && holdsADay(parts.slice(0, 3)) && holdsAClock(parts.slice(3));
}

function isEmailAddress(text: string): boolean {
  return emailAddress.test(text);
}

function isAbsoluteUri(text: string): boolean {
  return uriCharacters.test(text) && URL.canParse(text);
}

function isUuid(text: string): boolean {
  return uuidForm.test(text);
}

export const stringFormats = {
  date: { example: '2026-04-01', holds: isFullDate },
  'date-time': { example: '2026-04-01T09:30:00Z', holds: isDateAndTime },
  time: { example: '09:30:00Z', holds: isFullTime },
  email: { example: 'name@example.com', holds: isEmailAddress },
  uri: { example: 'https://example.com', holds: isAbsoluteUri },
  uuid: { example: '0f8fad5b-d9cb-469f-a165-70867728950e', holds: isUuid },
} satisfies Readonly<Record<string, StringFormat>>;

export type FormatName = keyof typeof stringFormats;

export function isFormatName(name: unknown): name is FormatName {
  return typeof name === 'string' && Object.hasOwn(stringFormats, name);
}

export const formatNames: readonly FormatName[] = Object.keys(stringFormats).filter((name) => isFormatName(name));
