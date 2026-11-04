import { holdsEveryWord } from '@on.auto/lookup';

import type { KeptMemory } from '../projection/memory-row-reading.ts';

export interface RecallAsk {
  readonly words: readonly string[];
  readonly tags: readonly string[];
  readonly mostCharacters: number;
  readonly now: string;
}

function stillKept({ expiresAt }: KeptMemory, now: string): boolean {
  return expiresAt === null || expiresAt > now;
}

function holdsEvery(row: KeptMemory, { words, tags }: RecallAsk): boolean {
  return tags.every((tag) => row.tags.includes(tag)) && holdsEveryWord(row.text, words);
}

export function newestFirst(
  one: Pick<KeptMemory, 'writtenAt' | 'id'>,
  other: Pick<KeptMemory, 'writtenAt' | 'id'>,
): number {
  if (one.writtenAt === other.writtenAt) {
    return one.id < other.id ? 1 : -1;
  }
  return one.writtenAt < other.writtenAt ? 1 : -1;
}

function withinCharacters(ranked: readonly KeptMemory[], mostCharacters: number): readonly KeptMemory[] {
  const taken: KeptMemory[] = [];
  let characters = 0;
  for (const row of ranked) {
    characters += row.characters;
    if (characters > mostCharacters) {
      return taken;
    }
    taken.push(row);
  }
  return taken;
}

export function rankedMemories(rowsExamined: readonly KeptMemory[], ask: RecallAsk): readonly KeptMemory[] {
  const matching = rowsExamined.filter((row) => stillKept(row, ask.now) && holdsEvery(row, ask));
  return withinCharacters(matching.toSorted(newestFirst), ask.mostCharacters);
}
