import { readFileSync } from 'node:fs';

import { RunLogEventSchema, stateFormat, type Step } from '@on.auto/workflow-engine';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { admissionWaitsOf } from './admission-waits.ts';

const AdmissionTimeoutSchema = Schema.fromJsonString(Schema.Struct({ events: Schema.Array(Schema.Unknown) }));

const { events } = Schema.decodeUnknownSync(AdmissionTimeoutSchema)(
  readFileSync(new URL('../../input-logs/admission-timeout.json', import.meta.url), 'utf8'),
);

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

function recordedWith(steps: readonly Step[]): unknown {
  return encodeEvent({
    type: 'input_applied',
    format: stateFormat,
    receipt: { kind: 'timer_fired', key: '5', at: Date.parse('2026-10-05T09:00:00.000Z') },
    steps,
    resumed: null,
    patch: [],
    outputs: [],
  });
}

const refusal = {
  kind: 'credits_exhausted',
  because: 'free_daily_limit',
  detail: 'The org has used today’s Free credits',
  resolve_at: 'https://studio.example.com/billing',
  lifts_at: '2026-10-02T00:00:00.000Z',
};

const until = 1790931600100;

describe('the admission waits of a run log event', () => {
  it('name each step that waits for admission, with its refusal, each time it waits again, and each step that stopped waiting, with no reading of the run log by the host', () => {
    const second = { step: 'do/1/second', run: 1 };

    expect(events.map((event) => admissionWaitsOf(event))).toEqual([
      [],
      [{ step: 'do/0/first', run: 1, waiting: false }],
      [{ ...second, waiting: true, refusal: { ...refusal, retry_at: 1790845260100, until } }],
      [],
      [{ ...second, waiting: true, refusal: { ...refusal, retry_at: 1790845380150, until } }],
      [],
      [{ ...second, waiting: true, refusal: { ...refusal, retry_at: 1790845620200, until } }],
      [],
      [{ ...second, waiting: true, refusal: { ...refusal, retry_at: 1790846100250, until } }],
      [{ ...second, waiting: false }],
    ]);
  });

  it('name no step that waits for admission without the refusal it waits out', () => {
    const waiting: Step = {
      reference: '/do/0/ask',
      run: 1,
      outcome: 'waiting',
      name: 'ask',
      times: 2,
      caused_by: 'input',
      waits_for: 'admission',
    };

    expect(admissionWaitsOf(recordedWith([waiting]))).toEqual([]);
  });

  it('refuse a record that is not a run log event', () => {
    expect(() => admissionWaitsOf({ type: 'run_started' })).toThrow('Expected "input_applied"');
  });
});
