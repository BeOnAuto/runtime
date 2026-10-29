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
  const from = `${dayOf(liftsAt(limit, at))} 00:00 UTC`;
  return limit === 'free_daily_limit'
    ? `It has used today's ${rate.per_day}, so it can run again from ${from}.`
    : `It has used this month's ${rate.per_month}, so it can run again from ${from}.`;
}

function keylessCase({ options, installation, licensedEver, rate }: CaseReading): FreeRateCase {
  const page = licensesPageOf(options, installation);
  return {
    kind: 'license_required',
    why: licensedEver
      ? `This runtime holds no key, so it runs at ${freeRateWords(rate)}.`
      : `This runtime has used its ${options.allowance} free runs, and without a key it runs at ${freeRateWords(rate)}.`,
    fix: `To run more, get a free key at ${page}, then activate it on the runtime.`,
    resolve_at: page,
  };
}

const takenAtTheReport = 'the runtime takes them at its next report, within the hour.';

function licenseCase({ because, license }: OfTheLicense, { options, installation, rate }: CaseReading): FreeRateCase {
  const free = freeRateWords(rate);
  const billing = billingPageOf(options, license.org);
  if (because === 'cap') {
    return {
      kind: 'credits_exhausted',
      why: `This runtime's org has reached its overage cap of ${license.credits.overage_cap} credits, so it runs at ${free}.`,
      fix: `An owner can add credits at ${billing}, which repay what is owed first; ${takenAtTheReport}`,
      resolve_at: billing,
    };
  }
  if (because === 'credits') {
    return {
      kind: 'credits_exhausted',
      why: `This runtime's org has no credits left, so it runs at ${free}.`,
      fix: `An owner can add credits at ${billing}; ${takenAtTheReport}`,
      resolve_at: billing,
    };
  }
  return {
    kind: 'license_invalid',
    why: `This runtime hasn't reached Auto since ${dayOf(license.issued_at)}, so since ${dayOf(license.limit_at)} it runs at ${free}.`,
    fix: "Check that it can reach billing.on.auto; it goes back to its org's credits at its next report.",
    resolve_at: licensesPageOf(options, installation),
  };
}

function refusedWords({ because, refused }: Refused, free: string, page: string): Pick<FreeRateCase, 'why' | 'fix'> {
  if (because === 'key_rotated') {
    return {
      why: `This runtime's key was replaced, so it runs at ${free}.`,
      fix: `Activate the new key an owner was shown when they rotated it; if the key is lost, an owner can rotate it again at ${page}.`,
    };
  }
  if (because === 'org_closed') {
    return {
      why: `This runtime's org at Auto is closed, so it runs at ${free}.`,
      fix:
        refused.because === 'org_purged'
          ? `The org can't be restored; activate a key of another org, which an owner registers at ${page}.`
          : `If an owner restores the org, the runtime goes back to its credits at its next report; or activate a key of another org, which an owner registers at ${page}.`,
    };
  }
  return refused.because === 'installation_revoked'
    ? {
        why: `This runtime was removed from its org, so it runs at ${free}.`,
        fix: `To run on its org's credits again, an owner can register it again at ${page}, then activate the new key.`,
      }
    : {
        why: `Auto no longer accepts this runtime's key, so it runs at ${free}.`,
        fix: `Activate a key of this runtime, which an owner registers at ${page}.`,
      };
}

function notActivatedWords({ options, licensedEver }: CaseReading, free: string): Pick<FreeRateCase, 'why' | 'fix'> {
  return {
    why: licensedEver
      ? `This runtime holds a key it hasn't activated with Auto yet, so it runs at ${free}.`
      : `This runtime has used its ${options.allowance} free runs and holds a key it hasn't activated with Auto yet, so it runs at ${free}.`,
    fix: 'Check that it can reach billing.on.auto; it activates the key at its next report, within the hour.',
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
