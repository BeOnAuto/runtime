import type { Conflict, Decided } from '@on.auto/operations';

import type { Fallback } from '../licensing/signed-answers.ts';
import type { FreeRateLimit, FreeRateUse } from './admission-events.ts';
import type { AllocationRecord } from './allocation-events.ts';
import type { Invalidity, LicenseRecord } from './license-events.ts';
import type { Footing } from './local-admission.ts';
import type { MeterEvent, Report } from './meter-events.ts';

export interface OfflineRule {
  readonly kind: 'offline';
  readonly through: number;
  readonly refusal: (installation: string) => Conflict;
}

export interface FreeRateReached {
  readonly installation: string;
  readonly footing: Exclude<Footing, { readonly kind: 'licensed' }>;
  readonly limit: FreeRateLimit;
  readonly rate: Fallback;
  readonly use: FreeRateUse;
  readonly licensedEver: boolean;
  readonly at: string;
}

export interface LocalRule {
  readonly kind: 'local';
  readonly key_sha256: string | undefined;
  readonly allowance: number;
  readonly free_rate: Fallback;
  readonly refusal: (reached: FreeRateReached) => Conflict;
}

export interface Admitting {
  readonly type: 'admit';
  readonly run: string;
  readonly at: string;
  readonly until: string;
  readonly installation: string;
  readonly rule: OfflineRule | LocalRule;
}

interface Identifying {
  readonly type: 'identify';
  readonly installation: string;
  readonly at: string;
}

export interface Licensing {
  readonly type: 'license';
  readonly license: LicenseRecord;
  readonly at: string;
}

export interface Invalidating {
  readonly type: 'invalidate';
  readonly key_sha256: string;
  readonly invalidity: Invalidity;
  readonly at: string;
}

export interface Reporting {
  readonly type: 'report';
  readonly report: Report;
  readonly license: LicenseRecord;
  readonly at: string;
}

export interface Allocating {
  readonly type: 'allocate';
  readonly allocation: AllocationRecord;
  readonly at: string;
}

export interface AllocationRefreshing {
  readonly type: 'refresh_allocation';
  readonly id: string;
  readonly refresh_by: string;
  readonly allocation: AllocationRecord['allocation'];
  readonly at: string;
}

export interface AllocationWithdrawing {
  readonly type: 'withdraw_allocation';
  readonly id: string;
  readonly detail: string;
  readonly at: string;
}

export interface AllocationReporting {
  readonly type: 'report_allocation';
  readonly spent: number;
  readonly at: string;
}

export type AllocationCommand = Allocating | AllocationRefreshing | AllocationWithdrawing | AllocationReporting;

export type MeterCommand = Admitting | Identifying | Licensing | Invalidating | Reporting | AllocationCommand;

export type DecidedEvent = Decided<MeterEvent>;
