import { verifyUsageReport, type AllocatedSource, type OfflineUsageReport } from '@on.auto/metering';
import { Schema } from 'effect';

import { openInstallation, openOfflineReporter } from '../index.ts';
import { allocationForReport } from '../offline-reconciliation/reading.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { offlineFixture } from './fixture.ts';

const reportRequest = Schema.decodeUnknownSync(
  Schema.Struct({ allocationId: Schema.String, signedReport: Schema.String }),
);

export async function reportingFixture(open = sqliteDatabase, sources?: readonly AllocatedSource[]) {
  const f = await offlineFixture(open, sources);
  const requests: Readonly<Request>[] = [];
  const received: OfflineUsageReport[] = [];
  const authority = { now: 1_000_000_000 };
  const fetch = async (request: Readonly<Request>) => {
    requests.push(request);
    const body = reportRequest(await request.clone().json());
    const allocation = await allocationForReport(f.options.connection, body.allocationId);
    const { report, checkpoint } = await verifyUsageReport(
      body.signedReport,
      allocation,
      f.installation.publicKey,
      authority.now,
    );
    received.push(report);
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
  const reporting = { connection: f.options.connection, installation: f.installation, authority: f.trust, fetch };
  const reporter = await openOfflineReporter(reporting);
  async function reportReplica() {
    const database = await f.database.reopen();
    return openOfflineReporter({
      ...reporting,
      connection: database.connection,
      installation: await openInstallation(database),
    });
  }
  return { ...f, reporting, reporter, reportReplica, requests, received, authority };
}
