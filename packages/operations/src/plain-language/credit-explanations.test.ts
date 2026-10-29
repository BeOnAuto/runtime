import { describe, expect, it } from 'vitest';

import { explanationOf, rejected, unsuccessfulWords, type ExplainedRejection } from '../index.ts';
import { internalTermsIn } from './internal-terms.ts';
import { mostRefusalCharacters } from './word-bounds.ts';

const refusals: ReadonlyArray<readonly [string, ExplainedRejection, string]> = [
  [
    'a runtime without a key that used its free runs for now',
    { reason: 'conflict', kind: 'license_required' },
    'Could not run the workflow “tally”: this runtime, which holds no key, has used the free runs it may run for now. The details below say when it can be run again; to run more, get a free key from Auto Studio at the resolve_at link in the details below, then activate it on the runtime.',
  ],
  [
    'a runtime without a key that used its free runs for the day',
    { reason: 'conflict', kind: 'license_required', because: 'free_daily_limit' },
    'Could not run the workflow “tally”: this runtime, which holds no key, has used its free runs for the day. The details below say when it can be run again; to run more, get a free key from Auto Studio at the resolve_at link in the details below, then activate it on the runtime.',
  ],
  [
    'a runtime without a key that used its free runs for the month',
    { reason: 'conflict', kind: 'license_required', because: 'free_month_used' },
    'Could not run the workflow “tally”: this runtime, which holds no key, has used its free runs for the month. The details below say when it can be run again; to run more, get a free key from Auto Studio at the resolve_at link in the details below, then activate it on the runtime.',
  ],
  [
    'a runtime at the free rate for the day while its license does not stand',
    { reason: 'conflict', kind: 'license_invalid', because: 'free_daily_limit' },
    'Could not run the workflow “tally”: the license of this runtime does not stand for now, so it runs at the free rate, and it has used its free runs for the day. The details below say why, what puts it right and when it can be run again, and an owner of its org can put it right in Auto Studio at their resolve_at link.',
  ],
  [
    'a runtime at the free rate for the month while its license does not stand',
    { reason: 'conflict', kind: 'license_invalid', because: 'free_month_used' },
    'Could not run the workflow “tally”: the license of this runtime does not stand for now, so it runs at the free rate, and it has used its free runs for the month. The details below say why, what puts it right and when it can be run again, and an owner of its org can put it right in Auto Studio at their resolve_at link.',
  ],
  [
    'a license that no longer stands',
    { reason: 'conflict', kind: 'license_invalid' },
    'Could not run the workflow “tally”: the license this runtime holds no longer stands. The details below say why and what to do, and an owner of its org can put it right in Auto Studio at their resolve_at link; then run this again.',
  ],
  [
    'a key that was replaced',
    { reason: 'conflict', kind: 'license_invalid', because: 'key_rotated' },
    'Could not run the workflow “tally”: the key of this runtime was replaced. Activate the new key an owner was shown when they rotated it, then run this again; if the key is lost, an owner can rotate it again at the resolve_at link in the details below.',
  ],
  [
    'a runtime removed from its org',
    { reason: 'conflict', kind: 'license_invalid', because: 'installation_revoked' },
    'Could not run the workflow “tally”: this runtime was removed from its org. To use it again, an owner can register it again at the resolve_at link in the details below, then activate the new key and run this again.',
  ],
  [
    'an account that is closed, which names no case',
    { reason: 'conflict', kind: 'account_closed' },
    'Could not run the workflow “tally”: the account it runs under is closed. A deleted org can be restored only for a limited time, after which it is purged and its runs never run again; the details below say which this is, and the resolve_at link, where they give one, says until when.',
  ],
  [
    'an account closed since its org was deleted',
    { reason: 'conflict', kind: 'account_closed', because: 'org_deleted' },
    'Could not run the workflow “tally”: the account it runs under is closed, since its org was deleted. An owner can restore the org only for a limited time, until the date at the resolve_at link in the details below, after which it is purged and its runs never run again; once it is restored, run this again.',
  ],
  [
    'an account closed since its org was deleted for good',
    { reason: 'conflict', kind: 'account_closed', because: 'org_purged' },
    'Could not run the workflow “tally”: the account it runs under is closed, since its org was deleted for good. The org can no longer be restored, so none of its runs will run again; the details below say more.',
  ],
  [
    'an account with no credits left, which names no case',
    { reason: 'conflict', kind: 'credits_exhausted' },
    'Could not run the workflow “tally”: the account it runs under has no credits left for it. It can be run again once the account has more credits; the details below say how, with the resolve_at link where they give one.',
  ],
  [
    'an account with no credits left',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'none_left' },
    'Could not run the workflow “tally”: the account it runs under has no credits left. An owner can get more credits at the resolve_at link in the details below, then run this again.',
  ],
  [
    'an account that used its free runs for the day',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit' },
    'Could not run the workflow “tally”: the account it runs under has used its free runs for the day. The details below say when it can be run again; an owner can get more credits sooner at their resolve_at link.',
  ],
  [
    'an account that used its free runs for the month',
    { reason: 'conflict', kind: 'credits_exhausted', because: 'free_month_used' },
    'Could not run the workflow “tally”: the account it runs under has used its free runs for the month. The details below say when it can be run again; an owner can get more credits sooner at their resolve_at link.',
  ],
];

function wordsOf({ reason, kind, because }: ExplainedRejection): string {
  const refused = { ...rejected(reason, 'x', undefined, kind), ...(because === undefined ? {} : { because }) };
  return unsuccessfulWords('run the workflow “tally”', 'query', refused);
}

describe('the words of a refusal of the meter', () => {
  it.each(refusals)('say what to do for %s, pointing at resolve_at where it links', (_, rejection, words) => {
    expect(wordsOf(rejection)).toBe(words);
    expect(words.length).toBeLessThanOrEqual(mostRefusalCharacters);
    expect(internalTermsIn(words)).toEqual([]);
  });

  it('give why of the case beside the kind where the case belongs to another kind', () => {
    expect(explanationOf({ reason: 'conflict', kind: 'license_required', because: 'none_left' }).why).toBe(
      'this runtime, which holds no key, has used the free runs it may run for now, because the account has no credits left',
    );
    expect(
      [
        explanationOf({ reason: 'conflict', kind: 'account_closed', because: 'free_daily_limit' }),
        explanationOf({ reason: 'conflict', kind: 'account_closed', because: 'free_month_used' }),
        explanationOf({ reason: 'conflict', kind: 'account_closed', because: 'key_rotated' }),
        explanationOf({ reason: 'conflict', kind: 'account_closed', because: 'installation_revoked' }),
        explanationOf({ reason: 'conflict', kind: 'license_required', because: 'org_deleted' }),
        explanationOf({ reason: 'conflict', kind: 'license_required', because: 'org_purged' }),
      ].map(({ why }) => why.slice(why.indexOf(', because') + 2)),
    ).toEqual([
      'because its free runs for the day are used',
      'because its free runs for the month are used',
      'because the key of this runtime was replaced',
      'because this runtime was removed from its org',
      'because its org was deleted, though for a limited time it can still be restored',
      'because its org was deleted for good',
    ]);
  });
});

describe('the words of a closed account said of a run’s record', () => {
  it('say what the record holds, the detail of its rejection, and never a link it does not hold', () => {
    const onRecord = [
      explanationOf({ reason: 'conflict', kind: 'account_closed' }),
      explanationOf({ reason: 'conflict', kind: 'account_closed', because: 'org_deleted' }),
    ].map(({ remedyOnRecord = '' }) => remedyOnRecord);

    expect(onRecord.map((remedy) => remedy.includes('the detail of the rejection below'))).toEqual([true, true]);
    expect(onRecord.filter((remedy) => remedy.includes('resolve_at'))).toEqual([]);
    expect(onRecord.flatMap((remedy) => internalTermsIn(remedy))).toEqual([]);
  });
});
