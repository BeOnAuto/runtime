import { describe, expect, it } from 'vitest';

import { explanationOf, rejected, unsuccessfulWords, type ExplainedRejection } from '../index.ts';
import { internalTermsIn } from './internal-terms.ts';
import { mostRefusalCharacters } from './word-bounds.ts';

const refusals: ReadonlyArray<readonly [string, ExplainedRejection, string]> = [
  [
    'a runtime that used its free runs',
    { reason: 'conflict', kind: 'license_required' },
    'Could not run the workflow “tally”: this runtime has used its free runs. Get a free key from Auto Studio at the resolve_at link in the details below, then activate it on the runtime and run this again.',
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
    'a meter that no longer agrees with its ledger',
    { reason: 'conflict', kind: 'metering_fault' },
    'Could not run the workflow “tally”: this runtime stopped starting runs, since what it counted no longer agrees with its ledger. Auto needs to repair it: the details below give its runtime id and link to Auto’s support at resolve_at. Reading, editing and exporting still work.',
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
      'this runtime has used its free runs, because the account has no credits left',
    );
    expect(
      [
        explanationOf({ reason: 'conflict', kind: 'metering_fault', because: 'free_daily_limit' }),
        explanationOf({ reason: 'conflict', kind: 'metering_fault', because: 'free_month_used' }),
        explanationOf({ reason: 'conflict', kind: 'metering_fault', because: 'key_rotated' }),
        explanationOf({ reason: 'conflict', kind: 'metering_fault', because: 'installation_revoked' }),
      ].map(({ why }) => why.slice(why.indexOf(', because') + 2)),
    ).toEqual([
      'because its free runs for the day are used',
      'because its free runs for the month are used',
      'because the key of this runtime was replaced',
      'because this runtime was removed from its org',
    ]);
  });
});
