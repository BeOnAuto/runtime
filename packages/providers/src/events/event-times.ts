import { instantOf, isTime } from '@on.auto/definitions/event-time';

const secondsSinceTheEpoch = /^(?<whole>\d{1,15})(?:\.(?<fraction>\d+))?$/u;

const mostFractionDigits = 9;

function writtenAsATime(seconds: string): string | undefined {
  const { whole, fraction } = secondsSinceTheEpoch.exec(seconds)?.groups ?? {};
  const instant = new Date(Number(whole) * 1000);
  if (Number.isNaN(instant.getTime())) {
    return undefined;
  }
  const fractionWritten = fraction === undefined ? '' : `.${fraction.slice(0, mostFractionDigits)}`;
  const written = `${instant.toISOString().slice(0, 19)}${fractionWritten}Z`;
  return isTime(written) ? written : undefined;
}

export function eventTimeOf(value: unknown): string | undefined {
  if (typeof value === 'string' && isTime(value)) {
    return value;
  }
  return typeof value === 'string' || typeof value === 'number' ? writtenAsATime(String(value)) : undefined;
}

export function millisecondsSinceTheEpochOf(value: unknown): number | undefined {
  const time = eventTimeOf(value);
  return time === undefined ? undefined : Number(instantOf(time)) * 1000;
}
