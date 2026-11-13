import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AccountClosedBecauseSchema, ConflictKindSchema, RejectionBecauseSchema, SettlementSchema } from '../index.ts';

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
