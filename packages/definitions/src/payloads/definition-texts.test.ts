import { sha256Of } from '@on.auto/content';
import { describe, expect, it } from 'vitest';

import { isTheSameText, textMembersOf, textsAsWritten, textsOf } from './definition-texts.ts';

const kept = { kept: { sha256: sha256Of('a document'), bytes: 10 } };

describe('the texts of a definition as its fact records them', () => {
  it('are each read from its arm, inline or kept, and written back to the same members', () => {
    const members = { source_sha256: kept.kept.sha256, source_bytes: 10, overview: 'An overview' };

    expect(textsOf(members)).toEqual({ source: kept, overview: { inline: 'An overview' } });
    expect(textMembersOf(textsOf(members))).toEqual(members);
    expect(textsOf({ source: 'a document', diagram: 'none' })).toEqual(
      textsAsWritten({ source: 'a document', diagram: 'none' }),
    );
  });
});

describe('two texts of a definition, compared without a read', () => {
  it('are the same where both are absent, the same text inline, or a text inline and one kept by its digest', () => {
    expect([
      isTheSameText(),
      isTheSameText({ inline: 'a document' }, { inline: 'a document' }),
      isTheSameText({ inline: 'a document' }, kept),
      isTheSameText(kept, { kept: { ...kept.kept } }),
    ]).toEqual([true, true, true, true]);
  });

  it('differ where one is absent, the texts differ, or a text inline that no store could keep meets a kept one', () => {
    const replaced = `a document${String.fromCodePoint(0xd800)}`;

    expect([
      isTheSameText(undefined, kept),
      isTheSameText({ inline: 'a document' }),
      isTheSameText({ inline: 'another document' }, kept),
      isTheSameText({ inline: replaced }, { kept: { sha256: sha256Of(replaced), bytes: 13 } }),
      isTheSameText({ inline: replaced }, { inline: 'a document�' }),
    ]).toEqual([false, false, false, false, false]);
  });
});
