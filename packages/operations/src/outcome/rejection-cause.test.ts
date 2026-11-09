import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { RejectionCauseSchema, SettlementSchema, type RejectionKind, type RejectionReason } from '../index.ts';
import { RejectionKindSchema, RejectionReasonSchema } from './rejection-cause.ts';

const decodeCause = Schema.decodeUnknownResult(RejectionCauseSchema);

const decodeSettlement = Schema.decodeUnknownSync(SettlementSchema);

const everyReason: Readonly<Record<RejectionReason, true>> = {
  invalid_input: true,
  forbidden: true,
  not_found: true,
  conflict: true,
  unavailable: true,
  cancelled: true,
  unanswered: true,
};

const aKindOfEachReason: readonly RejectionKind[] = [
  'input_schema',
  'tool_not_offered',
  'paused',
  'overrun',
  'expired',
];

const paused = {
  step: 'do/1/qualify',
  run_id: '4661c5f4-f2c0-548b-ad03-ee30974ca0ee',
  status: 'rejected',
  reason: 'conflict',
  kind: 'paused',
};

const malformed: readonly unknown[] = [
  { ...paused, reason: 'teapot' },
  { ...paused, kind: 'not_a_kind' },
  { ...paused, because: 'not_a_because' },
  { ...paused, status: 'cancelled' },
  { status: 'timed_out' },
];

describe('the cause of a rejected run', () => {
  it('names the step, the run it started, how its work ended, and with a rejection its reason, kind and because', () => {
    const broken = { ...paused, reason: 'unavailable', kind: 'tool_not_offered', because: 'connection_broken' };
    const timedOut = { step: 'do/1/qualify', status: 'timed_out' };

    expect([decodeCause(paused), decodeCause(broken), decodeCause(timedOut)]).toEqual([
      Result.succeed(paused),
      Result.succeed(broken),
      Result.succeed(timedOut),
    ]);
  });

  it('takes only the reasons, kinds and becauses of the one vocabulary, and the four ways a step’s work ends', () => {
    expect(RejectionReasonSchema.literals).toEqual(Object.keys(everyReason));
    expect(aKindOfEachReason.every((kind) => Schema.is(RejectionKindSchema)(kind))).toBe(true);
    expect(malformed.map((cause) => Result.isSuccess(decodeCause(cause)))).toEqual([false, false, false, false, false]);
  });
});

describe('the cause on a settlement', () => {
  it('is an optional member of a rejection for any reason but a cancellation, which no step causes', () => {
    const rejected = { status: 'rejected', detail: 'No', cause: paused };

    expect([
      decodeSettlement({ ...rejected, reason: 'invalid_input' }),
      decodeSettlement({ ...rejected, reason: 'unavailable' }),
      decodeSettlement({ ...rejected, reason: 'conflict' }),
      decodeSettlement({ ...rejected, reason: 'unanswered', kind: 'expired' }),
      decodeSettlement({ status: 'rejected', detail: 'No', reason: 'conflict' }),
    ]).toEqual([
      { ...rejected, reason: 'invalid_input' },
      { ...rejected, reason: 'unavailable' },
      { ...rejected, reason: 'conflict' },
      { ...rejected, reason: 'unanswered', kind: 'expired' },
      { status: 'rejected', detail: 'No', reason: 'conflict' },
    ]);
    expect(decodeSettlement({ ...rejected, reason: 'cancelled', kind: 'requested' })).not.toHaveProperty('cause');
  });
});
