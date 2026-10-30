import type { JsonObject } from '../dsl/json.ts';

const millisecondsPerDay = 86_400_000;

const daysFromCivilEpochToUnixEpoch = 719_468;

const daysPerEra = 146_097;

function civilDateOf(days: number): readonly [number, number, number] {
  const shifted = days + daysFromCivilEpochToUnixEpoch;
  const era = Math.floor(shifted / daysPerEra);
  const dayOfEra = shifted - era * daysPerEra;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

function padded(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function isoInstantOf(milliseconds: number): string {
  const days = Math.floor(milliseconds / millisecondsPerDay);
  const [year, month, day] = civilDateOf(days);
  const inDay = milliseconds - days * millisecondsPerDay;
  const time = [
    padded(Math.floor(inDay / 3_600_000), 2),
    padded(Math.floor(inDay / 60_000) % 60, 2),
    padded(Math.floor(inDay / 1000) % 60, 2),
  ].join(':');
  return `${padded(year, 4)}-${padded(month, 2)}-${padded(day, 2)}T${time}.${padded(inDay % 1000, 3)}Z`;
}

export function dateTimeOf(milliseconds: number): JsonObject {
  return { iso8601: isoInstantOf(milliseconds), epoch: { seconds: Math.floor(milliseconds / 1000), milliseconds } };
}
