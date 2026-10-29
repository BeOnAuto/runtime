import { billingPageOf, licensesPageOf, type MeterOptions } from '../admission/metering.ts';
import type { Fallback } from '../licensing/signed-answers.ts';
import type { FreeRateLimit } from '../meter-stream/admission-events.ts';
import type { Footing } from '../meter-stream/local-admission.ts';
import { countOf, credits, freeRuns, runs } from './counted-words.ts';
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
  return `the free rate of ${countOf(perDay, runs)} a UTC day and ${perMonth} a UTC month`;
}

export function liftsAt(limit: FreeRateLimit, at: string): string {
  return limit === 'free_daily_limit' ? nextDayOf(at) : nextMonthOf(at);
}

export function liftWords(limit: FreeRateLimit, at: string): string {
  const used = limit === 'free_daily_limit' ? "today's free runs" : "this month's free runs";
  return `It has used all of ${used}, so it can start runs again at 00:00 UTC on ${dayOf(liftsAt(limit, at))}.`;
}

function keylessCase({ options, installation, licensedEver, rate }: CaseReading): FreeRateCase {
  const page = licensesPageOf(options, installation);
  return {
    kind: 'license_required',
    why: licensedEver
      ? `This runtime has no license key, so it's limited to ${freeRateWords(rate)}.`
      : `This runtime has used its ${countOf(options.allowance, freeRuns)}. Without a license key, it's limited to ${freeRateWords(rate)}.`,
    fix: `To run more, get a free license key at ${page} and activate it on this runtime.`,
    resolve_at: page,
  };
}

function licenseCase({ because, license }: OfTheLicense, { options, installation, rate }: CaseReading): FreeRateCase {
  const free = freeRateWords(rate);
  const billing = billingPageOf(options, license.org);
  if (because === 'cap') {
    return {
      kind: 'credits_exhausted',
      why: `This runtime's organization has reached its overage cap of ${countOf(license.credits.overage_cap, credits)}, so the runtime is limited to ${free}.`,
      fix: `The account holder or an organization admin can add credits at ${billing}. New credits repay the overage first, and the runtime picks them up within the hour.`,
      resolve_at: billing,
    };
  }
  if (because === 'credits') {
    return {
      kind: 'credits_exhausted',
      why: `This runtime's organization is out of credits, so the runtime is limited to ${free}.`,
      fix: `The account holder or an organization admin can add credits at ${billing}; the runtime picks them up within the hour.`,
      resolve_at: billing,
    };
  }
  return {
    kind: 'license_invalid',
    why: `This runtime hasn't reached Auto since ${dayOf(license.issued_at)}, so it has been limited to ${free} since ${dayOf(license.limit_at)}.`,
    fix: "Make sure it can reach billing.on.auto. It goes back to its organization's credits at its next report, within the hour.",
    resolve_at: licensesPageOf(options, installation),
  };
}

function refusedWords({ because, refused }: Refused, free: string, page: string): Pick<FreeRateCase, 'why' | 'fix'> {
  if (because === 'key_rotated') {
    return {
      why: `This runtime's license key was replaced, so it's limited to ${free}.`,
      fix: `Activate the new key that was shown when the key was rotated. If that key is lost, the account holder or an organization admin can rotate it again at ${page}.`,
    };
  }
  if (because === 'org_closed') {
    return {
      why: `This runtime's organization at Auto is closed, so it's limited to ${free}.`,
      fix:
        refused.because === 'org_purged'
          ? `The organization can't be restored. The account holder or an admin of another organization can register this runtime at ${page}, then activate the new key.`
          : `If the organization is restored, the runtime goes back to the organization's credits at its next report. Otherwise, the account holder or an admin of another organization can register this runtime at ${page}, then activate the new key.`,
    };
  }
  return refused.because === 'installation_revoked'
    ? {
        why: `This runtime was removed from its organization, so it's limited to ${free}.`,
        fix: `To use the organization's credits again, the account holder or an organization admin can register it again at ${page}, then activate the new key.`,
      }
    : {
        why: `Auto no longer accepts this runtime's license key, so it's limited to ${free}.`,
        fix: `The account holder or an organization admin can register this runtime at ${page}, then activate the new key.`,
      };
}

function notActivatedWords({ options, licensedEver }: CaseReading, free: string): Pick<FreeRateCase, 'why' | 'fix'> {
  return {
    why: licensedEver
      ? `This runtime's license key isn't activated yet, so it's limited to ${free}.`
      : `This runtime has used its ${countOf(options.allowance, freeRuns)}. Its license key isn't activated yet, so it's limited to ${free}.`,
    fix: 'Make sure it can reach billing.on.auto. It activates the key at its next report, within the hour.',
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
