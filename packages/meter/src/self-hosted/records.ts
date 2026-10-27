import type { LicenseTime } from '../clock/records.ts';
import type { InstallationIdentity } from '../installation/records.ts';
import type { LicenseClient, LicensePollResult } from '../license-client/records.ts';
import type { ReportPollResult } from '../maintenance/reporting.ts';
import type { CapacitySnapshot } from '../offline-capacity/records.ts';
import type { OfflineReporter } from '../offline-reports/records.ts';
import type { OfflineMeter } from '../offline-reservations/records.ts';

export interface SelfHostedMeter {
  readonly time: () => Promise<LicenseTime>;
  readonly installation: InstallationIdentity;
  readonly license: LicenseClient;
  readonly capacity: () => Promise<CapacitySnapshot | undefined>;
  readonly accounting: OfflineMeter;
  readonly reporting: OfflineReporter;
  readonly maintain: () => Promise<SelfHostedMaintenance>;
}

export interface SelfHostedMaintenance {
  readonly license: LicensePollResult;
  readonly reporting: ReportPollResult;
  readonly retryInMilliseconds: number;
}
