import { instantOf, isTime } from '@on.auto/definitions/event-time';

const aSendersClockMs = 5 * 60 * 1000;

const secondsText = /^\d+(?:\.\d+)?$/u;

const spacedDate = /^(\d{4}-\d{2}-\d{2}) (?=\d)/u;

const offsetWithoutItsColon = /([+-]\d{2})(\d{2})$/u;

function inRfc3339(written: string): string {
  return written.replace(spacedDate, '$1T').replace(offsetWithoutItsColon, '$1:$2');
}

function secondsOf(written: unknown): number {
  if (typeof written === 'number') {
    return written;
  }
  if (typeof written !== 'string') {
    return Number.NaN;
  }
  if (secondsText.test(written)) {
    return Number(written);
  }
  const rfc3339 = inRfc3339(written);
  return isTime(rfc3339) ? Number(instantOf(rfc3339)) : Number.NaN;
}

export function writtenAtMs(written: unknown, readAtMs: number): number | undefined {
  const writtenMs = secondsOf(written) * 1000;
  return Number.isFinite(writtenMs) && writtenMs >= 0 && writtenMs <= readAtMs + aSendersClockMs
    ? writtenMs
    : undefined;
}
