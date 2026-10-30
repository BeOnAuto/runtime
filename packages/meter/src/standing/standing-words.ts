import { billingPageOf, licensesPageOf, type MeterOptions } from '../admission/metering.ts';
import { shownOrgName } from '../licensing/org-name.ts';
import type { Fallback } from '../licensing/signed-answers.ts';
import type { FreeRateUse } from '../meter-stream/admission-events.ts';
import type { HeldLicense } from '../meter-stream/license-events.ts';
import type { Footing } from '../meter-stream/local-admission.ts';
import { countOf, credits, freeRuns, runs } from './counted-words.ts';
import { freeRateCaseOf, freeRateWords, type FreeRateFooting } from './free-rate-cases.ts';
import { dayOf } from './utc-periods.ts';

export interface WordsReading {
  readonly options: MeterOptions;
  readonly installation: string;
  readonly footing: Footing;
  readonly licensedEver: boolean;
  readonly firstRunsUsed: number | undefined;
  readonly rate: Fallback;
  readonly use: FreeRateUse;
  readonly liftsAt: string | undefined;
  readonly licensed: number;
}

function liftedWords(liftsAt: string | undefined): string {
  return liftsAt === undefined ? '' : ` It can start runs again at 00:00 UTC on ${dayOf(liftsAt)}.`;
}

function usedWords({ rate, use, liftsAt }: WordsReading): string {
  return `It has used ${use.today} of today's ${countOf(rate.per_day, runs)} and ${use.this_month} of this month's ${rate.per_month}.${liftedWords(liftsAt)}`;
}

function standingNote(license: HeldLicense, options: MeterOptions): string {
  const { owed, overage_cap: cap } = license.credits;
  const billing = billingPageOf(options, license.org);
  const adding = `The account holder or an organization admin can add credits at ${billing}`;
  if (license.standing === 'low') return ` The organization's credits are running low. ${adding}.`;
  if (license.standing === 'empty') {
    return ` The organization is out of credits, so new runs go into overage, up to its cap of ${countOf(cap, credits)}. ${adding}; new credits repay the overage first.`;
  }
  if (license.standing === 'overage') {
    return ` The organization owes ${countOf(owed, credits)} of overage, and its cap is ${cap}. Its next credits repay the overage first.`;
  }
  if (license.standing === 'near_cap') {
    return ` The organization owes ${countOf(owed, credits)} of overage, close to its cap of ${cap}. At the cap, this runtime is limited to the free rate. ${adding}; new credits repay the overage first.`;
  }
  return '';
}

function licensedWords(license: HeldLicense, outOfTouch: boolean, { options, licensed }: WordsReading): string {
  const to = shownOrgName(license.org_name) ?? license.org;
  const left = Math.max(0, license.admits_through - licensed);
  const touch = outOfTouch
    ? ` It hasn't reached Auto since ${dayOf(license.issued_at)}. It will be limited to the free rate from ${dayOf(license.limit_at)} unless it reaches billing.on.auto first.`
    : '';
  return `Licensed to ${to} on the ${license.plan} plan, with ${countOf(left, runs)} left.${standingNote(license, options)}${touch}`;
}

function firstRunsWords(footing: FreeRateFooting, used: number, reading: WordsReading): string {
  const { options, installation, rate } = reading;
  const free = freeRateWords(rate);
  if (footing.kind === 'keyless') {
    return `This runtime has used ${used} of its ${countOf(options.allowance, freeRuns)}. After that, without a license key, it's limited to ${free}. Get a free license key at ${licensesPageOf(options, installation)}.`;
  }
  return `This runtime's license key isn't activated yet, so it's using its free runs: ${used} of ${options.allowance} used. After that, it's limited to ${free} until the key is activated. Make sure it can reach billing.on.auto. It activates the key at its next report, within the hour.`;
}

export function summaryOf(reading: WordsReading): string {
  const { footing, firstRunsUsed } = reading;
  if (footing.kind === 'licensed') return licensedWords(footing.license, footing.outOfTouch, reading);
  if (firstRunsUsed !== undefined) return firstRunsWords(footing, firstRunsUsed, reading);
  const { why, fix } = freeRateCaseOf(footing, reading);
  return `${why} ${usedWords(reading)} ${fix}`;
}
