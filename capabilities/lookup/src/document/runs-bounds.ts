import { stringFormats } from '@on.auto/json-schema';

const mostWordsCharacters = 1000;

const counted = new Intl.NumberFormat('en');

export function wordsProblem(words: string): string | undefined {
  const characters = Array.from(words).length;
  return characters > mostWordsCharacters
    ? `runs.words takes at most ${counted.format(mostWordsCharacters)} characters, and these take ${counted.format(characters)}`
    : undefined;
}

export function sinceMoment(since: string): number {
  if (stringFormats.date.holds(since)) {
    return Date.parse(`${since}T00:00:00Z`);
  }
  return stringFormats['date-time'].holds(since) ? Date.parse(since) : Number.NaN;
}

export function sinceProblem(since: string): string | undefined {
  return Number.isFinite(sinceMoment(since))
    ? undefined
    : `runs.since takes a day, such as 2026-10-01, or a date and time with its offset, such as 2026-10-01T09:00:00Z, and ${JSON.stringify(since)} is neither`;
}
