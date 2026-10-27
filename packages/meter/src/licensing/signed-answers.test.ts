import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { signedByTheTestKey, testSigners } from '../testing/test-signing.ts';
import { autoSigners, entitlementIn } from './signed-answers.ts';

const entitlement = {
  v: 1,
  kind: 'entitlement',
  installation: 'one',
  org: 'acme',
  plan: 'free',
  issued_at: '2026-10-27T12:00:00.000Z',
  expires_at: '2026-11-03T12:00:00.000Z',
};

describe('the keys the runtime trusts', () => {
  it('are Auto’s production key alone, which no setting adds to or replaces', () => {
    expect([...autoSigners]).toEqual([['auto-2026-10', 'fHkCk7CbSg4IZQQXqQj_SVl86CvA_O8eT7xo12JkVaY']]);
  });

  it('verify an answer the test key signed only where the testing entry adds that key', () => {
    const signed = signedByTheTestKey(entitlement);

    expect(Option.isNone(entitlementIn(signed, autoSigners))).toBe(true);
    expect(entitlementIn(signed, testSigners)).toEqual(Option.some(entitlement));
  });
});
