import type { Noun } from '@on.auto/operations';

export const runs: Noun = { one: 'run', other: 'runs' };

export const freeRuns: Noun = { one: 'free run', other: 'free runs' };

export const credits: Noun = { one: 'credit', other: 'credits' };

export const offlineCredits: Noun = { one: 'offline credit', other: 'offline credits' };

export function countOf(count: number, noun: Noun): string {
  return `${count} ${count === 1 ? noun.one : noun.other}`;
}
