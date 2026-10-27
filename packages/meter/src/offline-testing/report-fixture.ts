import type { AllocatedSource, OfflineUsageReport } from '@on.auto/metering';

import { openInstallation, openOfflineReporter } from '../index.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { offlineFixture } from './fixture.ts';
import { reportAuthority } from './report-authority.ts';

export async function reportingFixture(open = sqliteDatabase, sources?: readonly AllocatedSource[]) {
  const f = await offlineFixture(open, sources);
  const requests: Readonly<Request>[] = [];
  const received: OfflineUsageReport[] = [];
  const authority = { now: 1_000_000_000 };
  const reported = reportAuthority({
    connection: f.options.connection,
    installation: f.installation,
    now: () => authority.now,
    received: (report) => {
      received.push(report);
    },
  });
  const fetch = (request: Readonly<Request>) => {
    requests.push(request);
    return reported(request);
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
