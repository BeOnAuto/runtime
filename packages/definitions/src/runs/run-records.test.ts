import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AnsweredRecordSchema, RunEventSchema } from './run-events.ts';

const onTheRun = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'key_7f3a',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'qualify-lead',
  definitionVersion: 2,
};

const isARunFact = Schema.is(RunEventSchema);

const isARecordAnswered = Schema.is(AnsweredRecordSchema);

const promptKept = { prompt_sha256: 'a'.repeat(64), prompt_bytes: 17_038 };

function succeededWith(record: Schema.JsonObject) {
  return { type: 'run_succeeded', data: { output: { score: 0.8 }, record }, context: onTheRun };
}

describe('the record of a run that succeeded', () => {
  it('holds a prompt of any JSON value, keeps one outside by its digest and size, or holds none', () => {
    const records: readonly Schema.JsonObject[] = [
      { prompt: { message: 'Hi', truncated: false } },
      { prompt: 'Hi' },
      promptKept,
      { steps: 3 },
      {},
    ];

    expect(records.map((record) => isARunFact(succeededWith(record)))).toEqual([true, true, true, true, true]);
  });

  it('is refused with a digest and no size, a size and no digest, both arms of its prompt, or a digest or a size that is none', () => {
    const records: readonly Schema.JsonObject[] = [
      { prompt_sha256: promptKept.prompt_sha256 },
      { prompt_bytes: promptKept.prompt_bytes },
      { prompt: 'Hi', ...promptKept },
      { ...promptKept, prompt_sha256: 'A'.repeat(64) },
      { ...promptKept, prompt_bytes: -1 },
      { ...promptKept, prompt_bytes: 1.5 },
    ];

    expect(records.map((record) => isARunFact(succeededWith(record)))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the record a capability answers with', () => {
  it('holds its prompt, where it has one, and names none by a digest, since only the runtime keeps a prompt outside a run', () => {
    const records: readonly Schema.JsonObject[] = [{ prompt: 'Hi' }, { steps: 3 }, promptKept, { prompt_bytes: 5 }];

    expect(records.map((record) => isARecordAnswered(record))).toEqual([true, true, false, false]);
  });
});
