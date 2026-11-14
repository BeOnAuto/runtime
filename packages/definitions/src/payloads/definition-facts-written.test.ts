import { readFileSync } from 'node:fs';

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
