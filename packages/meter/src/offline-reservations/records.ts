import type { LicenseCapability, QuoteContext, RunIdentity, RunQuote, WorkBound } from '@on.auto/metering';

import type { CapacityState } from '../offline-capacity/records.ts';
import type { OfflineResult } from '../offline-ledger/records.ts';

export interface OfflineReserveRequest {
  readonly context: QuoteContext;
  readonly quote: RunQuote;
  readonly plan: WorkBound;
  readonly capabilities: readonly LicenseCapability[];
}

export interface OfflineDispatchRequest {
  readonly reservationId: string;
  readonly run: RunIdentity;
  readonly capability: LicenseCapability;
  readonly evidenceDigest: string;
}

export interface OfflineReleaseRequest {
  readonly reservationId: string;
  readonly reason: 'completed' | 'cancelled' | 'not-dispatched';
  readonly evidenceDigest: string;
}

export interface OfflineReservationPart {
  readonly lotId: string;
  readonly units: bigint;
  readonly reservedUnits: bigint;
  readonly committedUnits: bigint;
  readonly releasedUnits: bigint;
}

export interface OfflineReservation {
  readonly id: string;
  readonly allocationId: string;
  readonly allocationRevision: number;
  readonly allocationState: CapacityState;
  readonly context: QuoteContext;
  readonly quoteId: string;
  readonly capabilities: readonly LicenseCapability[];
  readonly maximumUnits: bigint;
  readonly admittedAt: number;
  readonly dispatchBefore: number;
  readonly state: 'held' | 'running' | 'settled';
  readonly parts: readonly OfflineReservationPart[];
}

export interface OfflineMeter {
  readonly reserve: (request: OfflineReserveRequest) => Promise<OfflineResult>;
  readonly commitDispatch: (request: OfflineDispatchRequest) => Promise<OfflineResult>;
  readonly release: (request: OfflineReleaseRequest) => Promise<OfflineResult>;
  readonly reservation: (id: string) => Promise<OfflineReservation | undefined>;
}
