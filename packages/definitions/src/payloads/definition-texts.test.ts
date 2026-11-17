import { readFileSync } from 'node:fs';

import { sha256Of } from '@on.auto/content';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { harness } from '../testing/harness.ts';
import { watchedStore } from '../testing/kept-payloads.ts';
import {
  definitionFactsStored,
  everyWayOfSaving,
  savingAFunction,
  savingAWorkflow,
} from '../testing/saved-definitions.ts';
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

const asTheReleaseBeforeWroteThem = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(
  readFileSync(new URL('definition-facts-written-inline.json', import.meta.url), 'utf8'),
);

const Stored = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
);

function withoutTheIdentity(text: string): string {
  const { type, data } = Schema.decodeUnknownSync(Stored)(text);
  const { definition_id: _id, playbook: _playbook, ...before } = data;
  return JSON.stringify({ type, data: type === 'definition_created' ? before : data });
}

const Identified = Schema.fromJsonString(
  Schema.Struct({ data: Schema.Struct({ definition_id: Schema.String, playbook: Schema.String }) }),
);

function identityOf(text: string): string {
  return Schema.decodeUnknownSync(Identified)(text).data.playbook;
}

describe('the facts of a definition saved while its playbook keeps nothing outside them', () => {
  it('are stored as the text the release before stored, member for member, for a workflow and a function, through every way a definition is saved, and read nothing', async () => {
    const watched = watchedStore();
    const definitions = harness(undefined, watched.store);
    await everyWayOfSaving(definitions, savingAWorkflow);
    await everyWayOfSaving(definitions, savingAFunction);

    const stored = await definitionFactsStored(definitions);

    expect(stored.map((text) => withoutTheIdentity(text))).toEqual(asTheReleaseBeforeWroteThem);
    expect(stored.filter((text) => text.includes('"definition_created"')).map((text) => identityOf(text))).toEqual([
      'alpha',
      'alpha',
    ]);
    expect(watched.reads()).toBe(0);
  });
});
