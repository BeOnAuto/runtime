import { memoriesBounds } from '@on.auto/definitions';
import { isCalendarDay } from '@on.auto/operations';
import { readDuration } from '@on.auto/workflow-engine/dsl';
import { Result } from 'effect';

const dayMs = 86_400_000;

export const memoryBounds = {
  ...memoriesBounds,
  defaultRecalledCharacters: 4000,
  shortestExpiryDays: 1,
  longestExpiryDays: 3650,
  mostKept: 10_000,
  mostExamined: 2000,
  mostWordsCharacters: 1000,
} as const;

const counted = new Intl.NumberFormat('en');

const tagPattern = new RegExp(memoryBounds.tagPattern, 'u');

export function charactersIn(text: string): number {
  return Array.from(text).length;
}

export function textProblem(text: string): string | undefined {
  const characters = charactersIn(text);
  if (text.trim() === '') {
    return 'The text of a memory is empty: a memory holds 1 to 2,000 characters of text';
  }
  return characters > memoryBounds.mostTextCharacters
    ? `The text of a memory holds at most ${counted.format(memoryBounds.mostTextCharacters)} characters, and this one has ${counted.format(characters)}`
    : undefined;
}

export function tagProblem(tag: string): string | undefined {
  return tagPattern.test(tag)
    ? undefined
    : `${JSON.stringify(tag)} is not a tag: a tag is 1 to 32 lowercase letters, digits and hyphens, starting with a letter or a digit`;
}

export function distinctTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags)];
}

export function wordsProblem(words: string): string | undefined {
  const characters = charactersIn(words);
  return characters > memoryBounds.mostWordsCharacters
    ? `The words to recall by hold at most ${counted.format(memoryBounds.mostWordsCharacters)} characters, and these hold ${counted.format(characters)}`
    : undefined;
}

export function tagCountProblem(count: number): string | undefined {
  return count > memoryBounds.mostTags
    ? `A memory takes at most ${memoryBounds.mostTags} tags, and these are ${count}`
    : undefined;
}

export interface About {
  readonly from: string;
  readonly to: string;
}

export function aboutProblem({ from, to }: About): string | undefined {
  return from <= to ? undefined : `What a memory is about ends on ${to}, before it begins on ${from}`;
}

const expiryBounds = `A memory expires after a duration from P${memoryBounds.shortestExpiryDays}D to P${memoryBounds.longestExpiryDays}D, such as P30D`;

export function expiryOf(written: string): Result.Result<number, string> {
  const reading = readDuration(written);
  if ('problem' in reading) {
    return Result.fail(`${reading.problem}. ${expiryBounds}`);
  }
  const { milliseconds } = reading;
  const within =
    milliseconds >= memoryBounds.shortestExpiryDays * dayMs && milliseconds <= memoryBounds.longestExpiryDays * dayMs;
  return within
    ? Result.succeed(milliseconds)
    : Result.fail(`${written} is not a time a memory may be kept. ${expiryBounds}`);
}

export function recalledCharactersProblem(characters: number): string | undefined {
  const within =
    Number.isSafeInteger(characters) && characters >= 1 && characters <= memoryBounds.mostRecalledCharacters;
  return within
    ? undefined
    : `A recall answers 1 to ${counted.format(memoryBounds.mostRecalledCharacters)} characters of text, not ${characters}`;
}

function noProblem(): undefined {
  return undefined;
}

export function expiryProblem(text: string): string | undefined {
  return Result.match(expiryOf(text), { onSuccess: noProblem, onFailure: (problem) => problem });
}

export function dayProblem(text: string): string | undefined {
  return isCalendarDay(text) ? undefined : `${JSON.stringify(text)} is not a day, as YYYY-MM-DD`;
}

const memoryIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isMemoryId(id: string): boolean {
  return memoryIdPattern.test(id);
}

export function memoryIdProblem(text: string): string | undefined {
  return isMemoryId(text) ? undefined : `${JSON.stringify(text)} is not the id of a memory`;
}

export function expiresAfter(text: string, now: number): string | undefined {
  return Result.match(expiryOf(text), {
    onSuccess: (milliseconds) => new Date(now + milliseconds).toISOString(),
    onFailure: noProblem,
  });
}
