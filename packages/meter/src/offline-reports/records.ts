import type { ConnectionPorts } from '@on.auto/ledger';
import type { LicenseTrust, OfflineRunCharge, OfflineUsageReport } from '@on.auto/metering';

import type { InstallationSigner } from '../installation/records.ts';
import type { LicenseFetch } from '../licensing/records.ts';
import type { CapacityReceipt, CapacitySnapshot } from '../offline-capacity/records.ts';

export interface OfflineReporterOptions {
  readonly connection: ConnectionPorts;
  readonly installation: InstallationSigner;
  readonly authority: Pick<LicenseTrust, 'issuer' | 'ring'>;
  readonly fetch: LicenseFetch;
}

export interface PreparedOfflineReport {
  readonly allocationId: string;
  readonly sequence: number;
  readonly checkpoint: string;
  readonly signedReport: string;
  readonly report: OfflineUsageReport;
}

export interface StoredOfflineReport extends PreparedOfflineReport {
  readonly snapshotRevision: number;
  readonly chargeRevision: number;
  readonly payload: string;
}

export interface ReportCharge extends OfflineRunCharge {
  readonly revision: number;
}

export interface ReportSnapshot {
  readonly capacity: CapacitySnapshot;
  readonly sequence: number;
  readonly reportedRevision: number;
  readonly previous: StoredOfflineReport | undefined;
  readonly charges: readonly ReportCharge[];
  readonly activeReservations: boolean;
  readonly observedTime: number;
}

export interface OfflineReportDelivery {
  readonly allocationId: string;
  readonly sequence: number;
  readonly checkpoint: string;
  readonly state: 'open' | 'closed' | 'quarantined';
  readonly status: 'acknowledged' | 'existing';
}

export interface OfflineReporter {
  readonly prepare: () => Promise<PreparedOfflineReport | undefined>;
  readonly pending: () => Promise<PreparedOfflineReport | undefined>;
  readonly requestClose: (allocationId: string) => Promise<CapacityReceipt>;
  readonly send: () => Promise<OfflineReportDelivery | undefined>;
}
