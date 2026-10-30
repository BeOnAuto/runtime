export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const daysInAnEra = 146_097;

const yearsInAnEra = 400;

const daysFromMarchToTheEpoch = 719_468;

export const millisecondsInADay = 86_400_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const daysOfTheMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (daysOfTheMonths[month - 1] ?? 0);
}

export function civilDay({ year, month, day }: CivilDate): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / yearsInAnEra);
  const yearOfEra = shifted - era * yearsInAnEra;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * daysInAnEra + dayOfEra - daysFromMarchToTheEpoch;
}

export function civilOfDay(days: number): CivilDate {
  const shifted = days + daysFromMarchToTheEpoch;
  const era = Math.floor(shifted / daysInAnEra);
  const dayOfEra = shifted - era * daysInAnEra;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * yearsInAnEra + (month <= 2 ? 1 : 0);
  return { year, month, day };
}
