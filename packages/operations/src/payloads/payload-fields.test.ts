import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostShownFieldBytes } from '../reading/public-event.ts';
import {
  answerPayloadOf,
  bytesNameOf,
  digestNameOf,
  inputPayloadOf,
  mostInlinePayloadBytes,
  outputPayloadOf,
  payloadFields,
  payloadIfAny,
  payloadMembers,
  payloadOf,
  payloadPointersOf,
  withPayloads,
  type Payload,
  type PayloadArm,
} from './payload-fields.ts';

const digest = 'a'.repeat(64);

const StartedSchema = withPayloads(
  Schema.Struct({
    ...payloadFields('input', Schema.Json),
    ...payloadFields('overview', Schema.String),
    started_by: Schema.String,
  }),
  ['input'],
  ['overview'],
);

const decodeStarted = Schema.decodeUnknownSync(StartedSchema);

function refusalOf(data: unknown): string {
  try {
    decodeStarted(data);
    return 'decoded';
  } catch (failure) {
    return String(failure);
  }
}

describe('a payload of a fact, kept inline or outside by its digest', () => {
  it('is kept outside past 16,384 bytes, the payload size threshold', () => {
    expect(mostInlinePayloadBytes).toBe(16_384);
  });

  it('is never kept outside within the 2,048 bytes a page of events shows a field whole, so no page reads a payload', () => {
    expect(mostShownFieldBytes).toBe(2048);
    expect(mostInlinePayloadBytes).toBeGreaterThanOrEqual(mostShownFieldBytes);
  });

  it('decodes as its value, or as its digest and size with no value, and names its members after it', () => {
    const inline = { input: { lead: 'lead-1' }, started_by: 'key_7f3a' };
    const kept = { input_sha256: digest, input_bytes: 91_844, started_by: 'key_7f3a' };

    expect([decodeStarted(inline), decodeStarted(kept)]).toEqual([inline, kept]);
    expect([digestNameOf('input'), bytesNameOf('input')]).toEqual(['input_sha256', 'input_bytes']);
  });

  it('holds a value shaped like a digest and a size as the value it is, inline', () => {
    const shapedLikeOne = { input: { sha256: digest, bytes: 12 }, started_by: 'key_7f3a' };

    expect(payloadOf(decodeStarted(shapedLikeOne), 'input')).toEqual({ inline: { sha256: digest, bytes: 12 } });
  });
});

describe('the schema of a fact that keeps a payload', () => {
  it('refuses both arms, neither arm of a payload that must be there, and a digest without its size or a size without its digest', () => {
    expect([
      refusalOf({ input: 1, input_sha256: digest, input_bytes: 1, started_by: 'k' }),
      refusalOf({ started_by: 'k' }),
      refusalOf({ input_sha256: digest, started_by: 'k' }),
      refusalOf({ input: 1, input_bytes: 1, started_by: 'k' }),
    ]).toEqual([
      expect.stringContaining('Expected input, or input_sha256 and input_bytes, and not both'),
      expect.stringContaining('Expected input, or input_sha256 and input_bytes'),
      expect.stringContaining('Expected input_sha256 and input_bytes together'),
      expect.stringContaining('Expected input_sha256 and input_bytes together'),
    ]);
  });

  it('names each refused payload by its own words alone, however many issues the decode is asked for', () => {
    const decodeAll = Schema.decodeUnknownExit(StartedSchema, { errors: 'all' });
    const refusals = [decodeAll({ started_by: 'k' }), decodeAll({ input_sha256: digest, started_by: 'k' })].map(String);

    expect(refusals).toEqual([
      expect.stringContaining('Expected input, or input_sha256 and input_bytes'),
      expect.stringContaining('Expected input_sha256 and input_bytes together'),
    ]);
    expect(refusals.filter((refusal) => refusal.includes('<filter>'))).toEqual([]);
  });

  it('may be absent where the fact may hold none, and holds one arm at most there too', () => {
    expect([
      refusalOf({ input: 1, started_by: 'k' }),
      refusalOf({ input: 1, overview: 'o', overview_sha256: digest, overview_bytes: 1, started_by: 'k' }),
    ]).toEqual(['decoded', expect.stringContaining('Expected overview, or overview_sha256 and overview_bytes')]);
  });

  it('refuses a digest that is not 64 lowercase hex digits and a size that is not a whole number of bytes', () => {
    expect([
      refusalOf({ input_sha256: digest.toUpperCase(), input_bytes: 1, started_by: 'k' }),
      refusalOf({ input_sha256: digest, input_bytes: -1, started_by: 'k' }),
      refusalOf({ input_sha256: digest, input_bytes: 1.5, started_by: 'k' }),
    ]).toEqual([
      expect.stringContaining('a SHA-256 in 64 lowercase hex digits'),
      expect.stringContaining('Expected a value greater than or equal to 0'),
      expect.stringContaining('Expected an integer'),
    ]);
  });
});

describe('a fact that keeps a payload, as its schema decodes it', () => {
  it("is typed with one arm of each payload it holds, which a run's accessor reads as it is", () => {
    const arms: readonly PayloadArm<'input', Schema.Json>[] = [
      decodeStarted({ input: { lead: 'lead-1' }, started_by: 'key_7f3a' }),
      decodeStarted({ input_sha256: digest, input_bytes: 91_844, started_by: 'key_7f3a' }),
    ];

    expect(arms.map((data) => inputPayloadOf({ data }))).toEqual([
      { inline: { lead: 'lead-1' } },
      { kept: { sha256: digest, bytes: 91_844 } },
    ]);
  });
});

describe('the payload a fact holds, read as one tagged value', () => {
  it('is its value inline, null among values, or its digest and size kept outside', () => {
    expect([
      payloadOf({ input: { lead: 'lead-1' } }, 'input'),
      payloadOf({ input: null }, 'input'),
      payloadOf({ input_sha256: digest, input_bytes: 3 }, 'input'),
    ]).toEqual([{ inline: { lead: 'lead-1' } }, { inline: null }, { kept: { sha256: digest, bytes: 3 } }]);
  });

  it('is none where the fact holds neither arm, which a payload that must be there takes for a defect of its caller', () => {
    expect([payloadIfAny({}, 'overview'), payloadIfAny({ overview_sha256: digest }, 'overview')]).toEqual([
      undefined,
      undefined,
    ]);
    expect(() => payloadOf({}, 'input')).toThrow(
      'The data holds neither input nor input_sha256 and input_bytes, which the schema of a fact that keeps the payload refuses',
    );
  });

  it("is a run's input, output or answer, read from the fact by name, as recorded today or kept outside", () => {
    const ending = { type: 'run_succeeded', data: { output: { score: 0.8 }, record: { steps: 3 } } };

    expect([
      inputPayloadOf({ data: { input: 'given' } }),
      outputPayloadOf(ending),
      answerPayloadOf({ data: { answer_sha256: digest, answer_bytes: 9 } }),
    ]).toEqual([{ inline: 'given' }, { inline: { score: 0.8 } }, { kept: { sha256: digest, bytes: 9 } }]);
  });

  it('is written back as the members of its arm, which the schema decodes and which read as the same payload', () => {
    const payloads: readonly Payload<Schema.Json>[] = [
      { inline: { lead: 'lead-1' } },
      { kept: { sha256: digest, bytes: 4 } },
    ];

    const written = payloads.map((payload) => ({ ...payloadMembers('input', payload), started_by: 'k' }));

    expect(written).toEqual([
      { input: { lead: 'lead-1' }, started_by: 'k' },
      { input_sha256: digest, input_bytes: 4, started_by: 'k' },
    ]);
    expect(written.map((data: unknown) => payloadOf(decodeStarted(data), 'input'))).toEqual(payloads);
  });
});

describe('the pointers that declare a payload', () => {
  it('name its digest and its size, at the root of the data or within a member, with names escaped', () => {
    expect([payloadPointersOf('input'), payloadPointersOf('source', '/content'), payloadPointersOf('a/b~c')]).toEqual([
      { sha256: '/input_sha256', bytes: '/input_bytes' },
      { sha256: '/content/source_sha256', bytes: '/content/source_bytes' },
      { sha256: '/a~1b~0c_sha256', bytes: '/a~1b~0c_bytes' },
    ]);
  });
});
