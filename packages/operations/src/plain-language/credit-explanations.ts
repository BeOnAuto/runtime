import type { ConflictKind } from '../outcome/conflict.ts';
import type { UnavailableKind } from '../outcome/unavailable.ts';
import type { Explanation } from './plain-language.ts';

type CreditKind = Extract<ConflictKind | UnavailableKind, 'credits_exhausted' | 'meter_unavailable'>;

export const creditExplanations: Readonly<Record<CreditKind, Explanation>> = {
  credits_exhausted: {
    why: 'the account it runs under has no credits left for it',
    remedy: 'Once the account has more credits, from its next grant or a purchase, it can be run again.',
  },
  meter_unavailable: {
    why: 'the account it runs under could not be asked for its credits',
    remedy: 'Nothing needs to change: trying again in a little while should work.',
  },
};
