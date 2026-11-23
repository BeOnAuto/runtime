import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../model/chat-model.ts';
import { memoryRowsInMemory, type Refused } from '../testing/index.ts';
import {
  conversationWithin,
  keptAfter,
  memoryWindow,
  turnRemembered,
  UNADDRESSED,
  type Earlier,
  type TurnOutcome,
  type TurnTaken,
} from './conversation-memory.ts';
import { conversationBytesWithin, MEMORY_BOUNDS, type MemoryBounds } from './memory-bounds.ts';
import type { Remembered } from './memory-rows.ts';

const bounds = (given: Partial<MemoryBounds>): MemoryBounds => ({ ...MEMORY_BOUNDS, ...given });

const earlier: readonly Earlier[] = [
  { author: 'context', sender: 'member-b', text: 'first' },
  { author: 'assistant', sender: undefined, text: 'second' },
  { author: 'context', sender: 'member-c', text: 'third' },
];

const asked = (remembered: TurnTaken['remembered'] = []): TurnTaken => ({
  remembered,
  earlier,
  sender: 'member-a',
  text: 'What runs today?',
});

const person: Remembered = { author: 'person', sender: 'member-a', text: 'What runs today?' };

const answer: Remembered = { author: 'assistant', sender: undefined, text: 'Two workflows run today.' };

const spent = { modelCalls: 2, toolCalls: 3 };

describe('the bounds of a conversation’s memory', () => {
  it('ship with the cloud’s window, its first read of a thread, and the budget the loop’s bounds leave', () => {
    expect(MEMORY_BOUNDS).toEqual({ rows: 100, threadMessages: 15, conversationBytes: 88_516 });
  });

  it('leave to the conversation what one request may hold, less the tools’ listing and the instructions', () => {
    expect(conversationBytesWithin({ requestInputTokens: 10, listingBytes: 3, instructionsBytes: 2 })).toBe(5);
  });
});

describe('the window of a conversation’s memory', () => {
  it.each<readonly [number, readonly string[]]>([
    [1, ['three']],
    [2, ['two', 'three']],
    [3, ['one', 'two', 'three']],
    [4, ['one', 'two', 'three']],
  ])('reads the newest %i rows in their order', async (rows, texts) => {
    const memory = memoryRowsInMemory(
      { author: 'person', sender: 'member-a', text: 'one' },
      { author: 'assistant', sender: undefined, text: 'two' },
      { author: 'person', sender: 'member-a', text: 'three' },
    );

    const window = await memoryWindow(memory, bounds({ rows }));

    expect(window.map(({ text }) => text)).toEqual(texts);
    expect(window.map(({ sequence }) => sequence)).toEqual([1, 2, 3].slice(3 - texts.length));
  });
});

describe('what a turn keeps', () => {
  it.each<readonly [string, TurnOutcome<Refused>, readonly Remembered[]]>([
    ['an answer', { answer: answer.text, bounded: false, ...spent }, [person, answer]],
    ['an answer cut at a bound', { answer: answer.text, bounded: true, ...spent }, [person, answer]],
    ['an answer of blank text', { answer: ' \n ', bounded: false, ...spent }, []],
    ['a refusal of the loop', { refused: 'bound_reached', ...spent }, [person]],
    ['a refusal of the model', { refused: 'refused_by_the_model', ...spent }, [person]],
    ['a client that went away', { closed: true, ...spent }, []],
    ['a reply judged not meant for Auto', UNADDRESSED, [{ ...person, author: 'overheard' }]],
  ])(
    'after %s on a later turn, keeps what that ending keeps, and never a tool call or its result',
    (_case, outcome, kept) => {
      const remembered = [{ ...person, text: 'Earlier', sequence: 1 }];

      expect(keptAfter(asked(remembered), outcome)).toEqual(kept);
    },
  );

  it.each<readonly [string, TurnOutcome<Refused>, readonly string[]]>([
    ['an answer', { answer: answer.text, bounded: false, ...spent }, ['second', 'third', person.text, answer.text]],
    ['a refusal', { refused: 'not_admitted', ...spent }, ['second', 'third', person.text]],
    ['a reply judged not meant for Auto', UNADDRESSED, ['second', 'third', person.text]],
    ['a client that went away', { closed: true, ...spent }, []],
  ])(
    'after %s on the first turn, keeps the newest earlier messages of the thread before it',
    (_case, outcome, texts) => {
      expect(keptAfter(asked(), outcome, bounds({ threadMessages: 2 })).map(({ text }) => text)).toEqual(texts);
    },
  );

  it('keeps no earlier message of the thread where it may read none', () => {
    const outcome: TurnOutcome<Refused> = { answer: answer.text, bounded: false, ...spent };

    expect(keptAfter(asked(), outcome, bounds({ threadMessages: 0 }))).toEqual([person, answer]);
  });

  it('appends what it keeps after what was remembered, and appends nothing where it keeps nothing', async () => {
    const memory = memoryRowsInMemory({ author: 'person', sender: 'member-a', text: 'Earlier' });
    const remembered = await memoryWindow(memory);

    await turnRemembered(memory, asked(remembered), { closed: true, ...spent });
    const afterNothing = memory.kept();
    await turnRemembered(memory, asked(remembered), { answer: answer.text, bounded: false, ...spent });

    expect(afterNothing).toEqual(remembered);
    expect(memory.kept()).toEqual([...remembered, { ...person, sequence: 2 }, { ...answer, sequence: 3 }]);
  });
});

describe('the conversation sent within its budget', () => {
  const messages: readonly ConversationMessage[] = [
    { role: 'user', text: 'aaa' },
    { role: 'assistant', text: 'bbb' },
    { role: 'user', text: 'cé' },
  ];

  it.each<readonly [number, readonly string[]]>([
    [9, ['aaa', 'bbb', 'cé']],
    [8, ['bbb', 'cé']],
    [6, ['bbb', 'cé']],
    [5, ['cé']],
    [1, ['cé']],
  ])(
    'leaves out the oldest messages until it holds at most %i bytes, and always keeps the newest',
    (mostBytes, texts) => {
      expect(conversationWithin(messages, mostBytes).map(({ text }) => text)).toEqual(texts);
    },
  );

  it('holds nothing where it was given nothing', () => {
    expect(conversationWithin([])).toEqual([]);
  });
});
