import { billingPageOf, licensesPageOf, type MeterOptions } from '../admission/metering.ts';
import { shownOrgName } from '../licensing/org-name.ts';
import type { Fallback } from '../licensing/signed-answers.ts';
import type { FreeRateUse } from '../meter-stream/admission-events.ts';
import type { HeldLicense } from '../meter-stream/license-events.ts';
import type { Footing } from '../meter-stream/local-admission.ts';
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
  return liftsAt === undefined ? '' : ` It can run again from ${dayOf(liftsAt)} 00:00 UTC.`;
}

function usedWords({ rate, use, liftsAt }: WordsReading): string {
  return `It has used ${use.today} of today's ${rate.per_day} and ${use.this_month} of this month's ${rate.per_month}.${liftedWords(liftsAt)}`;
}

function standingNote(license: HeldLicense, options: MeterOptions): string {
  const { owed, overage_cap: cap } = license.credits;
  const billing = billingPageOf(options, license.org);
  const owing = `the org owes ${owed} of at most ${cap} credits, which its next credits repay`;
  if (license.standing === 'low') return ` Its org's credits are low; an owner can add credits at ${billing}.`;
  if (license.standing === 'empty') {
    return ` Its org has no credits left, so its runs go into overage, which its next credits repay; an owner can add credits at ${billing}.`;
  }
  if (license.standing === 'overage') return ` It is in overage: ${owing}.`;
  if (license.standing === 'near_cap') {
    return ` It is near its overage cap: ${owing}; an owner can add credits at ${billing}.`;
  }
  return '';
}

function licensedWords(license: HeldLicense, outOfTouch: boolean, { options, licensed }: WordsReading): string {
  const to = shownOrgName(license.org_name) ?? license.org;
  const left = Math.max(0, license.admits_through - licensed);
  const touch = outOfTouch
    ? ` It hasn't reached Auto since ${dayOf(license.issued_at)}; unless it reaches billing.on.auto, it runs at the free rate from ${dayOf(license.limit_at)}.`
    : '';
  return `Licensed to ${to} (${license.plan} plan): ${left} runs left.${standingNote(license, options)}${touch}`;
}

function firstRunsWords(footing: FreeRateFooting, used: number, reading: WordsReading): string {
  const { options, installation, rate } = reading;
  const then = `then ${freeRateWords(rate)}`;
  if (footing.kind === 'keyless') {
    return `${used} of ${options.allowance} free runs used, ${then} without a key. Get a free key at ${licensesPageOf(options, installation)}.`;
  }
  return `This runtime holds a key it hasn't activated with Auto yet; until it does, it runs its free runs, ${used} of ${options.allowance} used, ${then}. Check that it can reach billing.on.auto; it activates the key at its next report, within the hour.`;
}

export function summaryOf(reading: WordsReading): string {
  const { footing, firstRunsUsed } = reading;
  if (footing.kind === 'licensed') return licensedWords(footing.license, footing.outOfTouch, reading);
  if (firstRunsUsed !== undefined) return firstRunsWords(footing, firstRunsUsed, reading);
  const { why, fix } = freeRateCaseOf(footing, reading);
  return `${why} ${usedWords(reading)} ${fix}`;
}
