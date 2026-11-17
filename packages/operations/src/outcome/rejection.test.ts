import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AccountClosedBecauseSchema,
  ConflictKindSchema,
  RejectionBecauseSchema,
  RejectionCauseSchema,
  type RejectionKind,
  type RejectionReason,
  SettlementSchema,
} from '../index.ts';
import { RejectionKindSchema, RejectionReasonSchema } from './rejection-cause.ts';

const decodeAccountClosedBecause = Schema.decodeUnknownResult(AccountClosedBecauseSchema);

const decodeSettlement = Schema.decodeUnknownSync(SettlementSchema);

describe('the refusal of a run whose account is closed', () => {
  it('is a conflict of the kind account_closed, with either reason an account is closed for', () => {
    const refused = {
      status: 'rejected',
      reason: 'conflict',
      detail: 'The org acme was deleted',
      kind: 'account_closed',
      because: 'org_deleted',
    };

    expect(decodeSettlement(refused)).toEqual(refused);
    expect([
      Schema.is(ConflictKindSchema)('account_closed'),
      Schema.is(RejectionBecauseSchema)('org_deleted'),
      Schema.is(RejectionBecauseSchema)('org_purged'),
    ]).toEqual([true, true, true]);
  });

  it('is closed for an org deleted, which can still be restored, or one purged, and for no other reason', () => {
    expect(
      ['org_deleted', 'org_purged', 'none_left', 'installation_revoked', 'org_suspended'].map((because) =>
        Result.isSuccess(decodeAccountClosedBecause(because)),
      ),
    ).toEqual([true, true, false, false, false]);
  });
});

describe('the refusal of a run stopped at a limit before it finished', () => {
  it.each([
    ['unworkable', 'max_tool_calls'],
    ['effect_unknown', 'max_tool_calls'],
    ['unworkable', 'max_input_tokens'],
    ['effect_unknown', 'max_input_tokens'],
  ])('is a conflict of the kind %s, because of %s', (kind, because) => {
    const stopped = { status: 'rejected', reason: 'conflict', detail: 'The run stopped at a limit', kind, because };

    expect(decodeSettlement(stopped)).toEqual(stopped);
  });

  it('names a limit by the setting that bounds it, and no other limit', () => {
    expect(
      ['max_tool_calls', 'max_input_tokens', 'max_output_tokens', 'max_tokens'].map((because) =>
        Schema.is(RejectionBecauseSchema)(because),
      ),
    ).toEqual([true, true, false, false]);
  });
});

const decodeCause = Schema.decodeUnknownResult(RejectionCauseSchema);

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
  'permission_denied',
  'not_allowed_token_type',
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
