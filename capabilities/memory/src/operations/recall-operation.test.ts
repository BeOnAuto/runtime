import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryHarness, type MemoryHarness } from '../testing/index.ts';

const RecalledTexts = Schema.Struct({
  output: Schema.Struct({ memories: Schema.Array(Schema.Struct({ text: Schema.String })) }),
});

const textsOf = Schema.decodeUnknownSync(RecalledTexts);

function askedAt(at: string | undefined) {
  return at === undefined ? {} : { at };
}

async function recalledTexts(harness: MemoryHarness, input: object, at?: string): Promise<readonly string[]> {
  const recalled = await harness.call(harness.operations.recall, input, askedAt(at));
  return textsOf(recalled).output.memories.map(({ text }) => text);
}

function keptInTurn(harness: MemoryHarness, memories: readonly object[]): Promise<void> {
  return memories.reduce<Promise<void>>(async (before, memory, index) => {
    await before;
    await harness.call(harness.operations.remember, memory, { at: `2026-10-0${index + 1}T09:00:00.000Z` });
  }, Promise.resolve());
}

describe('recall, across the scopes', () => {
  it('answers the memories kept, newest first, of the playbook and its organization unless it names one', async () => {
    const harness = memoryHarness();
    await keptInTurn(harness, [
      { text: 'Oldest, of the playbook' },
      { text: 'Of the organization', scope: 'organization' },
      { text: 'Newest, of the playbook' },
    ]);

    expect([
      await recalledTexts(harness, {}),
      await recalledTexts(harness, { scope: 'playbook' }),
      await recalledTexts(harness, { scope: 'organization' }),
    ]).toEqual([
      ['Newest, of the playbook', 'Of the organization', 'Oldest, of the playbook'],
      ['Newest, of the playbook', 'Oldest, of the playbook'],
      ['Of the organization'],
    ]);
  });

  it('answers memories written at the same moment by their ids, the later id first', async () => {
    const harness = memoryHarness();
    const ids = [
      await harness.rememberedId({ text: 'One' }),
      await harness.rememberedId({ text: 'Two', scope: 'organization' }),
      await harness.rememberedId({ text: 'Three' }),
    ];

    expect(await harness.call(harness.operations.recall, {})).toMatchObject({
      output: {
        memories: ids
          .toSorted()
          .toReversed()
          .map((id) => ({ id })),
      },
    });
  });
});

describe('recall, by words and tags', () => {
  it('keeps the memories that hold every word asked, in any case and any form, and have every tag asked', async () => {
    const harness = memoryHarness();
    await keptInTurn(harness, [
      { text: 'Deliveries to the Straße in Köln wait for Monday', tags: ['deliveries', 'germany'] },
      { text: 'Deliveries to Lyon wait for Tuesday', tags: ['deliveries'] },
    ]);

    expect([
      await recalledTexts(harness, { words: 'STRASSE köln' }),
      await recalledTexts(harness, { words: 'deliveries  wait' }),
      await recalledTexts(harness, { tags: ['deliveries', 'germany'] }),
      await recalledTexts(harness, { words: 'paris' }),
    ]).toEqual([
      ['Deliveries to the Straße in Köln wait for Monday'],
      ['Deliveries to Lyon wait for Tuesday', 'Deliveries to the Straße in Köln wait for Monday'],
      ['Deliveries to the Straße in Köln wait for Monday'],
      [],
    ]);
  });

  it('folds the case of every letter in full, so a dotted capital I is found by the dotted i it folds to alone', async () => {
    const harness = memoryHarness();
    await keptInTurn(harness, [{ text: 'The team meets in İstanbul in May' }]);

    expect([
      await recalledTexts(harness, { words: 'İSTANBUL' }),
      await recalledTexts(harness, { words: 'i\u0307stanbul' }),
      await recalledTexts(harness, { words: 'istanbul' }),
    ]).toEqual([['The team meets in İstanbul in May'], ['The team meets in İstanbul in May'], []]);
  });
});

describe('recall, within its bounds', () => {
  it('leaves out a memory that expired, or that was forgotten', async () => {
    const harness = memoryHarness();
    await keptInTurn(harness, [{ text: 'For a day', expires: 'P1D' }, { text: 'Until forgotten' }]);
    const forgotten = await harness.rememberedId({ text: 'Forgotten at once' }, { at: '2026-10-03T09:00:00.000Z' });
    await harness.call(harness.operations.forget, { id: forgotten });

    expect([
      await recalledTexts(harness, {}, '2026-10-01T12:00:00.000Z'),
      await recalledTexts(harness, {}, '2026-10-05T09:00:00.000Z'),
    ]).toEqual([['Until forgotten', 'For a day'], ['Until forgotten']]);
  });

  it('stops at the most characters asked, newest first, and examines at most as many rows of each scope as it may', async () => {
    const harness = memoryHarness({ mostExamined: 2 });
    await keptInTurn(harness, [{ text: 'aaaaaaaaaa' }, { text: 'bbbbbbbbbb' }, { text: 'cccccccccc' }]);

    expect([
      await recalledTexts(harness, { most_characters: 25 }),
      await recalledTexts(harness, { most_characters: 9 }),
      await recalledTexts(harness, {}),
    ]).toEqual([['cccccccccc', 'bbbbbbbbbb'], [], ['cccccccccc', 'bbbbbbbbbb']]);
  });
});

describe('the words of recall', () => {
  it('say how many memories it recalled', () => {
    const { plainLanguage } = memoryHarness().operations.recall.registration;
    const recalled = {
      id: 'memory-1',
      scope: 'playbook',
      text: 'x',
      tags: [],
      written_at: '2026-10-01T09:00:00.000Z',
      written_by: 'acme-admin',
    };

    expect([
      plainLanguage?.attempt({}),
      plainLanguage?.outcome({ memories: [] }, {}),
      plainLanguage?.outcome({ memories: [recalled] }, {}),
    ]).toEqual(['recall the memories', 'Nothing kept matches.', 'Recalled 1 memory.']);
  });
});
