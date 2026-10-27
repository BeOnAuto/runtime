import type { ConflictKind } from '../outcome/conflict.ts';
import type { UnavailableKind } from '../outcome/unavailable.ts';
import type { Explanation } from './plain-language.ts';

type CreditKind = Extract<
  ConflictKind | UnavailableKind,
  'credits_exhausted' | 'license_required' | 'license_invalid' | 'metering_fault' | 'meter_unavailable'
>;

export const creditExplanations: Readonly<Record<CreditKind, Explanation>> = {
  credits_exhausted: {
    why: 'the account it runs under has no credits left for it',
    remedy: 'Once the account has more credits, from its next grant or a purchase, it can be run again.',
  },
  license_required: {
    why: 'this runtime has run the actions it may before it is registered',
    remedy:
      'Register it in Auto Studio, where an org gets its key for free, and activate it with that key; the details below link there.',
  },
  license_invalid: {
    why: 'the license this runtime holds is revoked, expired or not one Auto issued',
    remedy: 'An owner of its org can see why in Auto Studio, and activate it again with a key that stands.',
  },
  metering_fault: {
    why: 'what this runtime counted no longer agrees with its ledger',
    remedy:
      'Nothing new runs until Auto repairs its meter; the details below link to Auto’s support. Everything else still works.',
  },
  meter_unavailable: {
    why: 'the account it runs under could not be asked for its credits',
    remedy: 'Nothing needs to change: trying again in a little while should work.',
  },
};
