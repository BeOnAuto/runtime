import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stateFormats, stateInCurrentFormat } from '../../index.ts';

const CorpusStateSchema = Schema.Struct({ state: Schema.Json });

const { state: stateOfFormatFour } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusStateSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-4.json', import.meta.url)), 'utf8'),
);

const [, , , formatFour] = stateFormats.older;

const listening = '/do/0/all/fork/branches/1/both';

const toJson = Schema.decodeUnknownSync(Schema.Json);

function replaced(state: Schema.Json, before: string, after: string): Schema.Json {
  return toJson(JSON.parse(JSON.stringify(state).replaceAll(before, after)));
}

describe('a state of format 4', () => {
  it('is upcast with no offers, no emissions, and a listener for each open listen whose filters name a type', () => {
    const upcast = stateInCurrentFormat(4, stateOfFormatFour);

    expect(formatFour?.format).toBe(4);
    expect([upcast.inbox.offeredIds, upcast.emitted, Object.values(upcast.listeners)]).toEqual([
      [],
      { count: 0, bytes: 0 },
      [{ runId: upcast.runId, reference: listening, run: 1 }],
    ]);
  });

  it('gives no listener to a listen whose filters name no type', () => {
    const untyped = replaced(stateOfFormatFour, '"with":{"type":"first"}', '"with":{"source":"/first"}');
    const typeless = replaced(untyped, '"with":{"type":"second"}', '"with":{"source":"/second"}');

    expect(stateInCurrentFormat(4, typeless).listeners).toEqual({});
  });

  it('is read strictly as format 4, so a state with what format 5 added is refused', () => {
    const withOffers = replaced(stateOfFormatFour, '"receivedIds":', '"offeredIds":[],"receivedIds":');

    expect(() => stateInCurrentFormat(4, withOffers)).toThrow(/excess property/u);
  });
});
