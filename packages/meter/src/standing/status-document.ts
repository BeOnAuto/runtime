import type { MeterOptions } from '../admission/metering.ts';
import { spentOf, standingAllocation } from '../allocations/allocation.ts';
import { isLiveAt, offlineCreditsStopped, type KeySource } from '../licensing/licensing.ts';
import type { Fallback, Standing } from '../licensing/signed-answers.ts';
import { freeRateInUse, freeRateLimitOf } from '../meter-stream/admission-events.ts';
import type { HeldLicense } from '../meter-stream/license-events.ts';
import {
  footingOf,
  freeRateOf,
  licenseOfFooting,
  onFirstRuns,
  type Footing,
  type LimitedBecause,
} from '../meter-stream/local-admission.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';
import { liftsAt } from './free-rate-cases.ts';
import { summaryOf, type WordsReading } from './standing-words.ts';

export type LicenseState = 'unregistered' | 'licensed' | 'out_of_touch' | 'limited' | 'offline' | 'invalid';

export type { LimitedBecause } from '../meter-stream/local-admission.ts';

export interface OfflineCredits {
  readonly credits: number;
  readonly spent: number;
  readonly usable_until: string;
}

export interface FreeRateStanding extends Fallback {
  readonly used_today: number;
  readonly used_this_month: number;
  readonly lifts_at: string | null;
}

export interface LicenseStatus {
  readonly state: LicenseState;
  readonly limited_because: LimitedBecause | null;
  readonly runtime_id: string;
  readonly free_runs: { readonly used: number; readonly of: number } | null;
  readonly org: string | null;
  readonly org_name: string | null;
  readonly plan: string | null;
  readonly standing: Standing | null;
  readonly licensed: number;
  readonly runs_left: number | null;
  readonly credits: HeldLicense['credits'] | null;
  readonly issued_at: string | null;
  readonly warn_at: string | null;
  readonly limit_at: string | null;
  readonly last_report_at: string | null;
  readonly fallback: FreeRateStanding | null;
  readonly key_source: KeySource | null;
  readonly offline: OfflineCredits | null;
  readonly invalid_because: string | null;
  readonly summary: string;
}

export interface StatusReading {
  readonly options: MeterOptions;
  readonly installation: string;
  readonly state: MeterState;
  readonly key_sha256: string | undefined;
  readonly key_source: KeySource | null;
  readonly at: string;
}

type LicenseFields = Pick<
  LicenseStatus,
  'org' | 'org_name' | 'plan' | 'standing' | 'credits' | 'issued_at' | 'warn_at' | 'limit_at' | 'last_report_at'
>;

const noLicense: LicenseFields = {
  org: null,
  org_name: null,
  plan: null,
  standing: null,
  credits: null,
  issued_at: null,
  warn_at: null,
  limit_at: null,
  last_report_at: null,
};

function licenseFieldsOf(license: HeldLicense | undefined): LicenseFields {
  if (license === undefined) return noLicense;
  const { org, org_name: orgName, plan, standing, credits, issued_at: issuedAt } = license;
  const { warn_at: warnAt, limit_at: limitAt, taken_at: takenAt } = license;
  return {
    org,
    org_name: orgName,
    plan,
    standing,
    credits,
    issued_at: issuedAt,
    warn_at: warnAt,
    limit_at: limitAt,
    last_report_at: takenAt,
  };
}

function stateOf(footing: Footing): LicenseState {
  if (footing.kind === 'keyless') return 'unregistered';
  if (footing.kind === 'limited') return 'limited';
  return footing.outOfTouch ? 'out_of_touch' : 'licensed';
}

function runsLeftOf(footing: Footing, licensed: number): number | null {
  if (footing.kind === 'licensed') return footing.license.admits_through - licensed;
  return licenseOfFooting(footing) === undefined ? null : 0;
}

function wordsReadingOf({ options, installation, state, at }: StatusReading, footing: Footing): WordsReading {
  const rate = freeRateOf(state, options.freeRate);
  const use = freeRateInUse(state.admitted, at);
  const limit = freeRateLimitOf(use, rate);
  return {
    options,
    installation,
    footing,
    licensedEver: state.license !== undefined,
    firstRunsUsed: onFirstRuns(state, options.allowance) ? state.admitted.first_runs : undefined,
    rate,
    use,
    liftsAt: limit === undefined ? undefined : liftsAt(limit, at),
    licensed: state.admitted.licensed,
  };
}

function fallbackOf({ footing, firstRunsUsed, rate, use, liftsAt: lifts }: WordsReading): FreeRateStanding | null {
  if (footing.kind === 'licensed' || firstRunsUsed !== undefined) return null;
  return { ...rate, used_today: use.today, used_this_month: use.this_month, lifts_at: lifts ?? null };
}

function keyedStatusOf(reading: StatusReading, footing: Footing): LicenseStatus {
  const { options, installation, state } = reading;
  const words = wordsReadingOf(reading, footing);
  const { admitted } = state;
  return {
    state: stateOf(footing),
    limited_because: footing.kind === 'limited' ? footing.because : null,
    runtime_id: installation,
    free_runs: words.licensedEver
      ? null
      : { used: Math.min(admitted.first_runs, options.allowance), of: options.allowance },
    ...licenseFieldsOf(licenseOfFooting(footing)),
    licensed: admitted.licensed,
    runs_left: runsLeftOf(footing, admitted.licensed),
    fallback: fallbackOf(words),
    key_source: reading.key_source,
    offline: null,
    invalid_because: null,
    summary: summaryOf(words),
  };
}

type Allocation = NonNullable<ReturnType<typeof standingAllocation>>;

function offlineStatusOf(keyed: LicenseStatus, reading: StatusReading, allocation: Allocation): LicenseStatus {
  const { installation, credits, refresh_by: refreshBy } = allocation;
  const offline = { credits, spent: spentOf(allocation, reading.state), usable_until: refreshBy };
  const live = isLiveAt(refreshBy, Date.parse(reading.at));
  const stopped = offlineCreditsStopped(reading.options, installation, refreshBy).detail;
  return {
    ...keyed,
    state: live ? 'offline' : 'invalid',
    limited_because: null,
    fallback: null,
    offline,
    invalid_because: live ? null : stopped,
    summary: live
      ? `Offline credits: ${offline.spent} of ${credits} used, usable until ${refreshBy.slice(0, 10)}`
      : stopped,
  };
}

export function statusOf(reading: StatusReading): LicenseStatus {
  const { state, key_sha256: sha256, at } = reading;
  const keyed = keyedStatusOf(reading, footingOf(state, sha256, at));
  const allocation = standingAllocation(state);
  return allocation === undefined ? keyed : offlineStatusOf(keyed, reading, allocation);
}
