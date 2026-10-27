import type { ConnectionPorts } from '@on.auto/ledger';
import { verifyUsageReport, type OfflineUsageReport } from '@on.auto/metering';
import { Schema } from 'effect';

import type { InstallationIdentity, LicenseFetch } from '../index.ts';
import { allocationForReport } from '../offline-reconciliation/reading.ts';

const reportRequest = Schema.decodeUnknownSync(
  Schema.Struct({ allocationId: Schema.String, signedReport: Schema.String }),
);

interface ReportingAuthority {
  readonly connection: ConnectionPorts;
  readonly installation: InstallationIdentity;
  readonly now: () => number;
  readonly received: (report: OfflineUsageReport) => void;
}

export function reportAuthority(options: ReportingAuthority): LicenseFetch {
  return async (request) => {
    const body = reportRequest(await request.clone().json());
    const allocation = await allocationForReport(options.connection, body.allocationId);
    const { report, checkpoint } = await verifyUsageReport(
      body.signedReport,
      allocation,
      options.installation.publicKey,
      options.now(),
    );
    options.received(report);
    const committed = report.counters.reduce((total, counter) => total + counter.committedUnits, 0n);
    const allocated = allocation.sources.reduce((total, source) => total + source.units, 0n);
    return Response.json(
      {
        state: report.close ? 'closed' : 'open',
        allocationId: allocation.id,
        sequence: report.sequence,
        checkpoint,
        committedUnits: String(committed),
        returnedUnits: String(report.close ? allocated - committed : 0n),
      },
      { status: 201 },
    );
  };
}
