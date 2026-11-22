import type { ConversationMessage } from '../model/chat-model.ts';
import type { TurnEnded } from '../turn/turn-state.ts';
import { MEMORY_BOUNDS, type MemoryBounds } from './memory-bounds.ts';
import type { MemoryRows, Remembered, RememberedRow } from './memory-rows.ts';

export interface Earlier {
  readonly author: 'context' | 'assistant';
  readonly sender: string | undefined;
  readonly text: string;
}

export interface TurnTaken {
  readonly remembered: readonly RememberedRow[];
  readonly earlier: readonly Earlier[];
  readonly sender: string;
  readonly text: string;
}

export const UNADDRESSED = { unaddressed: true } as const;

export type TurnOutcome<Refused> = TurnEnded<Refused> | typeof UNADDRESSED;

export function memoryWindow(
  rows: MemoryRows,
  bounds: MemoryBounds = MEMORY_BOUNDS,
): Promise<readonly RememberedRow[]> {
  return rows.newest(bounds.rows);
}

function earlierKept({ remembered, earlier }: TurnTaken, { threadMessages }: MemoryBounds): readonly Remembered[] {
  return remembered.length === 0 ? earlier.slice(Math.max(0, earlier.length - threadMessages)) : [];
}

function answeredKept(taken: TurnTaken, answer: string, bounds: MemoryBounds): readonly Remembered[] {
  if (answer.trim() === '') {
    return [];
  }
  return [
    ...earlierKept(taken, bounds),
    { author: 'person', sender: taken.sender, text: taken.text },
    { author: 'assistant', sender: undefined, text: answer },
  ];
}

export function keptAfter<Refused>(
  taken: TurnTaken,
  outcome: TurnOutcome<Refused>,
  bounds: MemoryBounds = MEMORY_BOUNDS,
): readonly Remembered[] {
  if ('unaddressed' in outcome) {
    return [...earlierKept(taken, bounds), { author: 'overheard', sender: taken.sender, text: taken.text }];
  }
  if ('answer' in outcome) {
    return answeredKept(taken, outcome.answer, bounds);
  }
  if ('refused' in outcome) {
    return [...earlierKept(taken, bounds), { author: 'person', sender: taken.sender, text: taken.text }];
  }
  return [];
}

export async function turnRemembered<Refused>(
  rows: MemoryRows,
  taken: TurnTaken,
  outcome: TurnOutcome<Refused>,
  bounds: MemoryBounds = MEMORY_BOUNDS,
): Promise<void> {
  const kept = keptAfter(taken, outcome, bounds);
  if (kept.length > 0) {
    await rows.appended(kept);
  }
}

const utf8 = new TextEncoder();

const bytesOf = (text: string): number => utf8.encode(text).byteLength;

export function conversationWithin(
  messages: readonly ConversationMessage[],
  mostBytes: number = MEMORY_BOUNDS.conversationBytes,
): readonly ConversationMessage[] {
  const sizes = messages.map(({ text }) => bytesOf(text));
  const first = sizes.findIndex(
    (_size, index) => sizes.slice(index).reduce((total, size) => total + size, 0) <= mostBytes,
  );
  return messages.slice(first === -1 ? Math.max(0, messages.length - 1) : first);
}
