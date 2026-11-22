import { describe, expect, it } from 'vitest';

import { aConversationKey, openedFor, sealedFor, SealedTextRefused, type RowBinding } from './sealed-texts.ts';

const row: RowBinding = ['chat_messages', 'conversation-1', 1, 'person', 'member-1'];

const byAuto: RowBinding = ['chat_messages', 'conversation-1', 1, 'assistant', null];

const text = 'Move the launch review to Tuesday and tell the agency.';

describe('a sealed text', () => {
  it('opens under its key on the row it was sealed for, and holds none of the text in the clear', () => {
    const key = aConversationKey();

    const sealed = sealedFor(key, row, text);

    expect(openedFor(key, row, sealed)).toBe(text);
    expect(sealed).not.toContain('Tuesday');
    expect(sealedFor(key, row, text)).not.toBe(sealed);
  });

  it.each<readonly [string, RowBinding, RowBinding]>([
    ['another row of its conversation', row, ['chat_messages', 'conversation-1', 2, 'person', 'member-1']],
    ['the same row of another conversation', row, ['chat_messages', 'conversation-2', 1, 'person', 'member-1']],
    ['the same place in another table', row, ['chat_summaries', 'conversation-1', 1, 'person', 'member-1']],
    ['its row given another author', row, ['chat_messages', 'conversation-1', 1, 'overheard', 'member-1']],
    ['its row given another sender', row, ['chat_messages', 'conversation-1', 1, 'person', 'member-2']],
    ['its row given no sender', row, ['chat_messages', 'conversation-1', 1, 'person', null]],
    ['a row of no sender given one', byAuto, ['chat_messages', 'conversation-1', 1, 'assistant', 'member-1']],
    [
      'a row of no sender given the sender named null',
      byAuto,
      ['chat_messages', 'conversation-1', 1, 'assistant', 'null'],
    ],
  ])('is refused on %s', (_case, sealedOn, openedOn) => {
    const key = aConversationKey();

    expect(() => openedFor(key, openedOn, sealedFor(key, sealedOn, text))).toThrow(SealedTextRefused);
  });

  it('opens on a row of no sender it was sealed for', () => {
    const key = aConversationKey();

    expect(openedFor(key, byAuto, sealedFor(key, byAuto, text))).toBe(text);
  });

  it('is refused under another key', () => {
    expect(() => openedFor(aConversationKey(), row, sealedFor(aConversationKey(), row, text))).toThrow(
      SealedTextRefused,
    );
  });
});

describe('a sealed text that does not open', () => {
  it.each([
    ['no parts', ''],
    ['one part', 'abc'],
    ['two parts', 'abc.def'],
    ['four parts', 'abc.def.ghi.jkl'],
  ])('is refused where it holds %s', (_case, sealed) => {
    expect(() => openedFor(aConversationKey(), row, sealed)).toThrow(SealedTextRefused);
  });

  it('is refused where its sealed text was changed', () => {
    const key = aConversationKey();
    const [iv, , tag] = sealedFor(key, row, text).split('.');

    const changed = `${String(iv)}.${Buffer.from('another text').toString('base64url')}.${String(tag)}`;

    expect(() => openedFor(key, row, changed)).toThrow(SealedTextRefused);
  });

  it.each([
    ['sealed', (key: string) => sealedFor(key, row, text)],
    ['opened', (key: string) => openedFor(key, row, 'abc.def.ghi')],
  ])('is not %s under a key that is not 32 bytes', (_case, use) => {
    expect(() => use(Buffer.alloc(16).toString('base64'))).toThrow(SealedTextRefused);
  });
});
