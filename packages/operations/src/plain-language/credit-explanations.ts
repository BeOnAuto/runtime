import type { ConflictKind } from '../outcome/conflict.ts';
import type { AccountClosedBecause, CreditsExhaustedBecause, RejectionBecause } from '../outcome/rejection-because.ts';
import type { UnavailableKind } from '../outcome/unavailable.ts';
import type { Explanation } from './plain-language.ts';

type CreditKind = Extract<
  ConflictKind | UnavailableKind,
  'credits_exhausted' | 'license_required' | 'license_invalid' | 'account_closed' | 'meter_unavailable'
>;

type CreditBecause = Extract<
  RejectionBecause,
  CreditsExhaustedBecause | 'key_rotated' | 'installation_revoked' | AccountClosedBecause
>;

const freeRunsAgain =
  'The details below say when it can be run again; an owner can get more credits sooner at their resolve_at link.';

const freeRateAgain =
  'The details below say when it can run again. To run more, get a free key from Auto Studio at the resolve_at link in the details below, then activate it on the runtime.';

const licenseAgain =
  'The details below explain why and when it can run again. The account holder or an organization admin can fix it in Auto Studio at the resolve_at link.';

export const creditExplanations: Readonly<Record<CreditKind, Explanation>> = {
  credits_exhausted: {
    why: 'the account it runs under has no credits left for it',
    remedy:
      'It can be run again once the account has more credits; the details below say how, with the resolve_at link where they give one.',
  },
  license_required: {
    why: 'this runtime has no license key and has used its free runs for now',
    remedy: freeRateAgain,
  },
  license_invalid: {
    why: 'the license this runtime holds no longer stands',
    remedy:
      'The details below say why and what to do, and an owner of its org can put it right in Auto Studio at their resolve_at link; then run this again.',
  },
  account_closed: {
    why: 'the account it runs under is closed',
    remedy:
      'A deleted org can be restored only for a limited time, after which it is purged and its runs never run again; the details below say which this is, and the resolve_at link, where they give one, says until when.',
    remedyOnRecord:
      'A deleted org can be restored only for a limited time, after which it is purged and its runs never run again; the detail of the rejection below says which this is.',
  },
  meter_unavailable: {
    why: 'the account it runs under could not be asked for its credits',
    remedy: 'Try again shortly.',
  },
};

export const creditBecauses: Readonly<Record<CreditBecause, string>> = {
  none_left: 'because the account has no credits left',
  free_daily_limit: 'because its free runs for the day are used',
  free_month_used: 'because its free runs for the month are used',
  key_rotated: 'because the key of this runtime was replaced',
  installation_revoked: 'because this runtime was removed from its org',
  org_deleted: 'because its org was deleted, though for a limited time it can still be restored',
  org_purged: 'because its org was deleted for good',
};

export const creditExplanationsByBecause: Readonly<
  Record<
    'license_required' | 'credits_exhausted' | 'license_invalid' | 'account_closed',
    Partial<Record<RejectionBecause, Explanation>>
  >
> = {
  license_required: {
    free_daily_limit: {
      why: 'this runtime has no license key and has used its free runs for the day',
      remedy: freeRateAgain,
    },
    free_month_used: {
      why: 'this runtime has no license key and has used its free runs for the month',
      remedy: freeRateAgain,
    },
  },
  credits_exhausted: {
    none_left: {
      why: 'the account it runs under has no credits left',
      remedy: 'An owner can get more credits at the resolve_at link in the details below, then run this again.',
    },
    free_daily_limit: { why: 'the account it runs under has used its free runs for the day', remedy: freeRunsAgain },
    free_month_used: { why: 'the account it runs under has used its free runs for the month', remedy: freeRunsAgain },
  },
  license_invalid: {
    free_daily_limit: {
      why: "this runtime's license can't be used right now, so it runs at the free rate and has used its free runs for the day",
      remedy: licenseAgain,
    },
    free_month_used: {
      why: "this runtime's license can't be used right now, so it runs at the free rate and has used its free runs for the month",
      remedy: licenseAgain,
    },
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
  account_closed: {
    org_deleted: {
      why: 'the account it runs under is closed, since its org was deleted',
      remedy:
        'An owner can restore the org only for a limited time, until the date at the resolve_at link in the details below, after which it is purged and its runs never run again; once it is restored, run this again.',
      remedyOnRecord:
        'An owner can restore the org only for a limited time, after which it is purged and its runs never run again; the detail of the rejection below gives what its account said, and once the org is restored, it can be run again.',
    },
    org_purged: {
      why: 'the account it runs under is closed, since its org was deleted for good',
      remedy: 'The org can no longer be restored, so none of its runs will run again; the details below say more.',
    },
  },
};
