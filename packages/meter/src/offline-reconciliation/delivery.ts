import type { LicenseTransport } from '../licensing/records.ts';
import { LicenseServiceRefused, licenseTransport } from '../licensing/transport.ts';
import { prepareOfflineReport } from '../offline-reports/preparation.ts';
import type { OfflineReportDelivery, OfflineReporterOptions, StoredOfflineReport } from '../offline-reports/records.ts';
import { acknowledgeOfflineReport } from './acknowledgement.ts';

async function delivered(transport: LicenseTransport, prepared: StoredOfflineReport): Promise<unknown> {
  try {
    return await transport('/licenses/usage-reports', {
      allocationId: prepared.allocationId,
      signedReport: prepared.signedReport,
    });
  } catch (error) {
    if (!(error instanceof LicenseServiceRefused) || error.status !== 409) throw error;
    return { state: 'quarantined', allocationId: prepared.allocationId, reason: 'allocation_quarantined' };
  }
}

export function reportSender(options: OfflineReporterOptions) {
  const transport = licenseTransport(options.authority.issuer, options.fetch);
  return async (): Promise<OfflineReportDelivery | undefined> => {
    const prepared = await prepareOfflineReport(options);
    if (prepared === undefined) return undefined;
    return acknowledgeOfflineReport(options, prepared, await delivered(transport, prepared));
  };
}
