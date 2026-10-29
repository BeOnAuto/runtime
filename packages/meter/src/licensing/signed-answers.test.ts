import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { signedByTheTestKey, testSigners } from '../testing/test-signing.ts';
import { autoSigners, licenseIn } from './signed-answers.ts';

const license = {
  v: 2,
  kind: 'license',
  installation: 'one',
  org: 'acme',
  plan: 'team',
  policy: '2026-10-28',
  issued_at: '2026-10-27T12:00:00.000Z',
  warn_at: '2026-11-10T12:00:00.000Z',
  limit_at: '2026-11-24T12:00:00.000Z',
  charged_through: 40,
  admits_through: 640,
  standing: 'ok',
  credits: { available: 2000, owed: 0, overage_cap: 600 },
  fallback: { per_day: 15, per_month: 75 },
};

describe('the keys the runtime trusts', () => {
  it('are Auto’s production key alone, which no setting adds to or replaces', () => {
    expect([...autoSigners]).toEqual([['auto-2026-10', 'fHkCk7CbSg4IZQQXqQj_SVl86CvA_O8eT7xo12JkVaY']]);
  });

  it('verify a license the test key signed only where the testing entry adds that key', () => {
    const signed = signedByTheTestKey(license);

    expect(Option.isNone(licenseIn(signed, autoSigners))).toBe(true);
    expect(licenseIn(signed, testSigners)).toEqual(Option.some({ ...license, org_name: null }));
  });
});

function nameSignedAs(orgName: unknown): string | null | undefined {
  return Option.getOrUndefined(licenseIn(signedByTheTestKey({ ...license, org_name: orgName }), testSigners))?.org_name;
}

describe('the license Auto signs', () => {
  it('names its org on one line, and names none where its name is blank or null', () => {
    expect([nameSignedAs(' Acme\n\tCorporation '), nameSignedAs(' ​ '), nameSignedAs(null)]).toEqual([
      'Acme Corporation',
      null,
      null,
    ]);
  });

  it.each([
    ['an earlier version', { v: 1 }],
    ['no license', { kind: 'entitlement' }],
    ['a standing it does not know', { standing: 'frozen' }],
    ['a negative count', { charged_through: -1 }],
    ['no free rate', { fallback: undefined }],
  ] as const)('is no license when it is of %s', (_, change) => {
    expect(Option.isNone(licenseIn(signedByTheTestKey({ ...license, ...change }), testSigners))).toBe(true);
  });
});
