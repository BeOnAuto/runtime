import { mostRefusalCharacters } from '@on.auto/phrasing';
import { describe, expect, it } from 'vitest';

import { explanationOf, rejected, unsuccessfulWords, type ExplainedRejection } from '../index.ts';
import { internalTermsIn } from './internal-terms.ts';

const refusals: ReadonlyArray<readonly [string, ExplainedRejection, boolean]> = [
  ['a runtime without a key that used its free runs for now', { reason: 'conflict', kind: 'license_required' }, true],
  [
    'a runtime without a key that used its free runs for the day',
    { reason: 'conflict', kind: 'license_required', because: 'free_daily_limit' },
    true,
  ],
  [
    'a runtime without a key that used its free runs for the month',
    { reason: 'conflict', kind: 'license_required', because: 'free_month_used' },
    true,
  ],
  [
    "a runtime at the free rate for the day while its license can't be used",
    { reason: 'conflict', kind: 'license_invalid', because: 'free_daily_limit' },
    true,
  ],
  [
    "a runtime at the free rate for the month while its license can't be used",
    { reason: 'conflict', kind: 'license_invalid', because: 'free_month_used' },
    true,
  ],
  ['a license that no longer stands', { reason: 'conflict', kind: 'license_invalid' }, true],
  ['a key that was replaced', { reason: 'conflict', kind: 'license_invalid', because: 'key_rotated' }, true],
  [
    'a runtime removed from its org',
    { reason: 'conflict', kind: 'license_invalid', because: 'installation_revoked' },
    true,
  ],
  ['a license that lacks a feature the work needs', { reason: 'conflict', kind: 'feature_unlicensed' }, false],
  ['an account that is closed, which names no case', { reason: 'conflict', kind: 'account_closed' }, true],
  [
    'an account closed since its org was deleted',
    { reason: 'conflict', kind: 'account_closed', because: 'org_deleted' },
    true,
  ],
  [
    'an account closed since its org was deleted for good',
    { reason: 'conflict', kind: 'account_closed', because: 'org_purged' },
    false,
  ],
  ['an organization out of credits, which names no case', { reason: 'conflict', kind: 'credits_exhausted' }, true],
  ['an organization out of credits', { reason: 'conflict', kind: 'credits_exhausted', because: 'none_left' }, true],
  [
    "an organization that has used today's free runs, in Auto Cloud or where the refusal names no more",
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit' },
    true,
  ],
  [
    "an organization that has used this month's free runs, in Auto Cloud or where the refusal names no more",
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_month_used' },
    true,
  ],
  [
    'a self-hosted runtime at the free rate for the day, since its organization is out of credits',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit', limited_because: 'credits' },
    true,
  ],
  [
    'a self-hosted runtime at the free rate for the month, since its organization is out of credits',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_month_used', limited_because: 'credits' },
    true,
  ],
  [
    'a self-hosted runtime at the free rate for the day, since its organization reached its overage cap',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit', limited_because: 'cap' },
    true,
  ],
  [
    'a self-hosted runtime at the free rate for the month, since its organization reached its overage cap',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_month_used', limited_because: 'cap' },
    true,
  ],
];

function wordsOf({ reason, kind, because, limited_because: limitedBecause }: ExplainedRejection): string {
  const refused = {
    ...rejected(reason, 'x', undefined, kind),
    ...(because === undefined ? {} : { because }),
    ...(limitedBecause === undefined ? {} : { limited_because: limitedBecause }),
  };
  return unsuccessfulWords('run the workflow “tally”', 'query', refused);
}

function explained(rejection: ExplainedRejection): string {
  return explanationOf(rejection).why;
}

describe('the words of a refusal of the meter', () => {
  it.each(refusals)('say what to do for %s, pointing at resolve_at where it links', (_, rejection, links) => {
    const words = wordsOf(rejection);

    expect(words.length).toBeLessThanOrEqual(mostRefusalCharacters);
    expect(internalTermsIn(words)).toEqual([]);
    expect(words.includes('resolve_at')).toBe(links);
  });

  it('differ for every kind and case', () => {
    const said = refusals.map(([, rejection]) => wordsOf(rejection));

    expect(new Set(said).size).toBe(refusals.length);
  });

  it('give why of the case beside the kind where the case belongs to another kind', () => {
    const mismatched = [
      ['license_required', 'none_left'],
      ['account_closed', 'free_daily_limit'],
      ['account_closed', 'free_month_used'],
      ['account_closed', 'key_rotated'],
      ['account_closed', 'installation_revoked'],
      ['license_required', 'org_deleted'],
      ['license_required', 'org_purged'],
    ] as const;
    const whys = mismatched.map(([kind, because]) => explained({ reason: 'conflict', kind, because }));
    const ofTheKinds = mismatched.map(([kind]) => `${explained({ reason: 'conflict', kind })}, because `);

    expect(whys.map((why, at) => why.startsWith(String(ofTheKinds[at])))).toEqual(mismatched.map(() => true));
    expect(new Set(whys.map((why) => why.slice(why.indexOf(', because')))).size).toBe(mismatched.length);
  });
});

describe('the words of a refusal that says why the runtime is limited to the free rate', () => {
  it('keep the words of its kind and case where the reason belongs to no credit refusal at the free rate', () => {
    expect([
      explained({ reason: 'conflict', kind: 'credits_exhausted', because: 'none_left', limited_because: 'credits' }),
      explained({
        reason: 'conflict',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
        limited_because: 'out_of_touch',
      }),
      explained({ reason: 'conflict', kind: 'license_invalid', because: 'free_daily_limit', limited_because: 'cap' }),
    ]).toEqual([
      explained({ reason: 'conflict', kind: 'credits_exhausted', because: 'none_left' }),
      explained({ reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit' }),
      explained({ reason: 'conflict', kind: 'license_invalid', because: 'free_daily_limit' }),
    ]);
  });
});

describe('the words of a closed account said of a run’s record', () => {
  it('say what the record holds, the detail of its rejection, and never a link it does not hold', () => {
    const onRecord = [
      explanationOf({ reason: 'conflict', kind: 'account_closed' }),
      explanationOf({ reason: 'conflict', kind: 'account_closed', because: 'org_deleted' }),
    ].map(({ remedyOnRecord = '' }) => remedyOnRecord);

    expect(onRecord.map((remedy) => remedy.toLowerCase().includes('rejection below'))).toEqual([true, true]);
    expect(onRecord.filter((remedy) => remedy.includes('resolve_at'))).toEqual([]);
    expect(onRecord.flatMap((remedy) => internalTermsIn(remedy))).toEqual([]);
  });
});
