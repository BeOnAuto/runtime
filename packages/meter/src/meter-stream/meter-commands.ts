import type { Decided } from '@on.auto/operations';

import type { Counting } from '../counting/run-starts.ts';
import type { Signed } from '../licensing/signed-answers.ts';
import type { Fault, LicenseRecord, MeterEvent, Report } from './meter-events.ts';

export interface Admitting {
  readonly type: 'admit';
  readonly run: string;
  readonly counting: Counting;
  readonly allowance: number;
  readonly at: string;
  readonly until: string;
  readonly installation: string;
  readonly refusal: (installation: string) => string;
}

interface Checkpointing {
  readonly type: 'count';
  readonly counting: Counting;
  readonly at: string;
}

interface Faulting {
  readonly type: 'fault';
  readonly fault: Fault;
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
  readonly detail: string;
  readonly at: string;
}

export interface Reporting {
  readonly type: 'report';
  readonly report: Report;
  readonly at: string;
}

export interface Repairing {
  readonly type: 'repair';
  readonly id: string;
  readonly reason: string;
  readonly issued_at: string;
  readonly repair: Signed;
  readonly counting: Counting;
  readonly at: string;
}

export type MeterCommand = Admitting | Checkpointing | Faulting | Licensing | Invalidating | Reporting | Repairing;

export type DecidedEvent = Decided<MeterEvent>;
