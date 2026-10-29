import { billingPageOf, licensesPageOf, type MeterOptions } from '../admission/metering.ts';
import type { Fallback } from '../licensing/signed-answers.ts';
import type { FreeRateLimit } from '../meter-stream/admission-events.ts';
import type { Footing } from '../meter-stream/local-admission.ts';
import { dayOf, nextDayOf, nextMonthOf } from './utc-periods.ts';

export type FreeRateFooting = Exclude<Footing, { readonly kind: 'licensed' }>;

type Limited = Extract<Footing, { readonly kind: 'limited' }>;

type OfTheLicense = Extract<Limited, { readonly because: 'credits' | 'cap' | 'out_of_touch' }>;

type Refused = Extract<Limited, { readonly refused: unknown }>;

export interface FreeRateCase {
  readonly kind: 'license_required' | 'credits_exhausted' | 'license_invalid';
  readonly why: string;
  readonly fix: string;
  readonly resolve_at: string;
}

export interface CaseReading {
  readonly options: MeterOptions;
  readonly installation: string;
  readonly licensedEver: boolean;
  readonly rate: Fallback;
}

export function freeRateWords({ per_day: perDay, per_month: perMonth }: Fallback): string {
  return `the free rate of ${perDay} runs a UTC day and ${perMonth} a UTC month`;
}

export function liftsAt(limit: FreeRateLimit, at: string): string {
  return limit === 'free_daily_limit' ? nextDayOf(at) : nextMonthOf(at);
}

export function liftWords(limit: FreeRateLimit, rate: Fallback, at: string): string {
  const from = `00:00 UTC on ${dayOf(liftsAt(limit, at))}`;
  return limit === 'free_daily_limit'
    ? `It has used today's ${rate.per_day} free runs and can run again at ${from}.`
    : `It has used this month's ${rate.per_month} free runs and can run again at ${from}.`;
}

function keylessCase({ options, installation, licensedEver, rate }: CaseReading): FreeRateCase {
  const page = licensesPageOf(options, installation);
  return {
    kind: 'license_required',
    why: licensedEver
      ? `This runtime has no license key, so it runs at ${freeRateWords(rate)}.`
      : `This runtime has used its ${options.allowance} free runs. Without a license key, it runs at ${freeRateWords(rate)}.`,
    fix: `To run more, get a free key at ${page}, then activate it on the runtime.`,
    resolve_at: page,
  };
}

const takenAtTheReport = 'The runtime picks them up at its next report, within the hour.';

function licenseCase({ because, license }: OfTheLicense, { options, installation, rate }: CaseReading): FreeRateCase {
  const free = freeRateWords(rate);
  const billing = billingPageOf(options, license.org);
  if (because === 'cap') {
    return {
      kind: 'credits_exhausted',
      why: `This runtime's organization has reached its overage cap of ${license.credits.overage_cap} credits, so it runs at ${free}.`,
      fix: `The account holder or an organization admin can add credits at ${billing}; they repay what's owed first. ${takenAtTheReport}`,
      resolve_at: billing,
    };
  }
  if (because === 'credits') {
    return {
      kind: 'credits_exhausted',
      why: `This runtime's organization has no credits left, so it runs at ${free}.`,
      fix: `The account holder or an organization admin can add credits at ${billing}. ${takenAtTheReport}`,
      resolve_at: billing,
    };
  }
  return {
    kind: 'license_invalid',
    why: `This runtime hasn't reached Auto since ${dayOf(license.issued_at)}, so it has run at ${free} since ${dayOf(license.limit_at)}.`,
    fix: "Check that it can reach billing.on.auto. It returns to its organization's credits at its next report.",
    resolve_at: licensesPageOf(options, installation),
  };
}

function refusedWords({ because, refused }: Refused, free: string, page: string): Pick<FreeRateCase, 'why' | 'fix'> {
  if (because === 'key_rotated') {
    return {
      why: `This runtime's key was replaced, so it runs at ${free}.`,
      fix: `Activate the new key shown when it was rotated. If that key is lost, the account holder or an organization admin can rotate it again at ${page}.`,
    };
  }
  if (because === 'org_closed') {
    return {
      why: `This runtime's organization at Auto is closed, so it runs at ${free}.`,
      fix:
        refused.because === 'org_purged'
          ? `The organization can't be restored. Activate a key from another organization; the account holder or an organization admin can register it at ${page}.`
          : `If the organization is restored, the runtime returns to its credits at its next report. Otherwise, activate a key from another organization; the account holder or an organization admin can register it at ${page}.`,
    };
  }
  return refused.because === 'installation_revoked'
    ? {
        why: `This runtime was removed from its organization, so it runs at ${free}.`,
        fix: `To use its organization's credits again, the account holder or an organization admin can register it again at ${page}. Then activate the new key.`,
      }
    : {
        why: `Auto no longer accepts this runtime's key, so it runs at ${free}.`,
        fix: `Activate a key for this runtime. The account holder or an organization admin can register it at ${page}.`,
      };
}

function notActivatedWords({ options, licensedEver }: CaseReading, free: string): Pick<FreeRateCase, 'why' | 'fix'> {
  return {
    why: licensedEver
      ? `This runtime has a key it hasn't activated with Auto yet, so it runs at ${free}.`
      : `This runtime has used its ${options.allowance} free runs and has a key it hasn't activated with Auto yet, so it runs at ${free}.`,
    fix: 'Check that it can reach billing.on.auto. It activates the key at its next report, within the hour.',
  };
}

export function freeRateCaseOf(footing: FreeRateFooting, reading: CaseReading): FreeRateCase {
  if (footing.kind === 'keyless') return keylessCase(reading);
  if ('refused' in footing || footing.because === 'not_activated') {
    const page = licensesPageOf(reading.options, reading.installation);
    const free = freeRateWords(reading.rate);
    const words = 'refused' in footing ? refusedWords(footing, free, page) : notActivatedWords(reading, free);
    return { kind: 'license_invalid', ...words, resolve_at: page };
  }
  return licenseCase(footing, reading);
}
