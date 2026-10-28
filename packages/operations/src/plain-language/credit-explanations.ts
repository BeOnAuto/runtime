import type { ConflictKind } from '../outcome/conflict.ts';
import type { RejectionBecause } from '../outcome/rejection-because.ts';
import type { UnavailableKind } from '../outcome/unavailable.ts';
import type { Explanation } from './plain-language.ts';

type CreditKind = Extract<
  ConflictKind | UnavailableKind,
  'credits_exhausted' | 'license_required' | 'license_invalid' | 'metering_fault' | 'meter_unavailable'
>;

type CreditBecause = Extract<
  RejectionBecause,
  'none_left' | 'free_daily_limit' | 'free_month_used' | 'key_rotated' | 'installation_revoked'
>;

const freeRunsAgain =
  'The details below say when it can be run again; an owner can get more credits sooner at their resolve_at link.';

export const creditExplanations: Readonly<Record<CreditKind, Explanation>> = {
  credits_exhausted: {
    why: 'the account it runs under has no credits left for it',
    remedy:
      'It can be run again once the account has more credits; the details below say how, with the resolve_at link where they give one.',
  },
  license_required: {
    why: 'this runtime has used its free runs',
    remedy:
      'Get a free key from Auto Studio at the resolve_at link in the details below, then activate it on the runtime and run this again.',
  },
  license_invalid: {
    why: 'the license this runtime holds no longer stands',
    remedy:
      'The details below say why and what to do, and an owner of its org can put it right in Auto Studio at their resolve_at link; then run this again.',
  },
  metering_fault: {
    why: 'this runtime stopped starting runs, since what it counted no longer agrees with its ledger',
    remedy:
      'Auto needs to repair it: the details below give its runtime id and link to Auto’s support at resolve_at. Reading, editing and exporting still work.',
  },
  meter_unavailable: {
    why: 'the account it runs under could not be asked for its credits',
    remedy: 'Nothing needs to change: trying again in a little while should work.',
  },
};

export const creditBecauses: Readonly<Record<CreditBecause, string>> = {
  none_left: 'because the account has no credits left',
  free_daily_limit: 'because its free runs for the day are used',
  free_month_used: 'because its free runs for the month are used',
  key_rotated: 'because the key of this runtime was replaced',
  installation_revoked: 'because this runtime was removed from its org',
};

export const creditExplanationsByBecause: Readonly<
  Record<'credits_exhausted' | 'license_invalid', Partial<Record<RejectionBecause, Explanation>>>
> = {
  credits_exhausted: {
    none_left: {
      why: 'the account it runs under has no credits left',
      remedy: 'An owner can get more credits at the resolve_at link in the details below, then run this again.',
    },
    free_daily_limit: { why: 'the account it runs under has used its free runs for the day', remedy: freeRunsAgain },
    free_month_used: { why: 'the account it runs under has used its free runs for the month', remedy: freeRunsAgain },
  },
  license_invalid: {
    key_rotated: {
      why: 'the key of this runtime was replaced',
      remedy:
        'Activate the new key an owner was shown when they rotated it, then run this again; if the key is lost, an owner can rotate it again at the resolve_at link in the details below.',
    },
    installation_revoked: {
      why: 'this runtime was removed from its org',
      remedy:
        'To use it again, an owner can register it again at the resolve_at link in the details below, then activate the new key and run this again.',
    },
  },
};
