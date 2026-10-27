import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { usageReportPayload } from '@on.auto/metering';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openOfflineReporter, type InstallationSigner, type LicenseFetch } from '../index.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { dispatchRequest, reserveRequest } from './fixture.ts';
import { reportingFixture } from './report-fixture.ts';

function afterFirstSignature(
  sign: InstallationSigner['signReport'],
  action: () => Promise<unknown>,
): InstallationSigner['signReport'] {
  let called = false;
  return async (report) => {
    const signed = await sign(report);
    if (!called) {
      called = true;
      await action();
    }
    return signed;
  };
}

function together(fetch: LicenseFetch, count: number): LicenseFetch {
  const all = Promise.withResolvers<void>();
  let arrived = 0;
  return async (request) => {
    arrived += 1;
    if (arrived === count) all.resolve();
    await all.promise;
    return fetch(request);
  };
}

function reordered(fetch: LicenseFetch): LicenseFetch {
  const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
  return async (request) =>
    Response.json(Object.fromEntries(Object.entries(record(await (await fetch(request)).json())).toReversed()));
}

function afterReceiptLookup(connection: ConnectionPorts, action: () => Promise<unknown>): ConnectionPorts {
  let called = false;
  return {
    ...connection,
    read: async (sql) => {
      const rows = await connection.read(sql);
      if (!called && sql.strings.join('').includes('FROM meter_report_receipts')) {
        called = true;
        await action();
      }
      return rows;
    },
  };
}

export function reportRaces(open: () => Promise<MeterDatabase>): void {
  describe('concurrent report acknowledgement', () => {
    duplicateDelivery(open);
  });
  describe('changed snapshots during signing', () => {
    changedSnapshot(open);
  });
  describe('delayed acknowledgements', () => {
    delayedAcknowledgement(open);
  });
}

function duplicateDelivery(open: () => Promise<MeterDatabase>): void {
  it('persists one receipt for twenty sends across replicas and JSON property orders', async () => {
    const f = await reportingFixture(open);
    await f.reporter.requestClose(f.allocation.id);
    await f.reporter.prepare();
    const fetch = together(f.reporting.fetch, 20);
    const first = await openOfflineReporter({ ...f.reporting, fetch });
    const next = await f.database.reopen();
    const second = await openOfflineReporter({ ...f.reporting, connection: next.connection, fetch: reordered(fetch) });
    const results = await Promise.all(Array.from({ length: 10 }, () => [first.send(), second.send()]).flat());
    expect(results.filter((result) => result?.status === 'acknowledged')).toHaveLength(1);
    expect(results.filter((result) => result?.status === 'existing')).toHaveLength(19);
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_report_receipts`)).toHaveLength(1);
    expect((await f.capacity.snapshot())?.state).toBe('closed');
    expect(new Set(f.received.map(usageReportPayload)).size).toBe(1);
  });
}

function changedSnapshot(open: () => Promise<MeterDatabase>): void {
  it('recaptures source counters when dispatch races report signing', async () => {
    const f = await reportingFixture(open);
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    const reporter = await openOfflineReporter({
      ...f.reporting,
      installation: {
        ...f.installation,
        signReport: afterFirstSignature(f.installation.signReport, () =>
          f.meter.commitDispatch(dispatchRequest(hold, request)),
        ),
      },
    });
    const prepared = await reporter.prepare();
    expect(prepared?.report.charges).toHaveLength(1);
    expect(prepared?.report.counters.reduce((total, counter) => total + counter.committedUnits, 0n)).toBe(1_000_000n);
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_local_reports`)).toHaveLength(1);
  });

  it('freezes admission before a final report even when the close request races signing', async () => {
    const f = await reportingFixture(open);
    const reporter = await openOfflineReporter({
      ...f.reporting,
      installation: {
        ...f.installation,
        signReport: afterFirstSignature(f.installation.signReport, () => f.reporter.requestClose(f.allocation.id)),
      },
    });
    expect((await reporter.prepare())?.report.close).toBe(true);
    expect((await f.capacity.snapshot())?.state).toBe('closing');
    expect(await reporter.send()).toMatchObject({ state: 'closed' });
  });
}

function delayedAcknowledgement(open: () => Promise<MeterDatabase>): void {
  it('recovers an accepted close when another replica finishes between receipt lookup and snapshot', async () => {
    const f = await reportingFixture(open);
    await f.reporter.requestClose(f.allocation.id);
    await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: afterReceiptLookup(f.options.connection, () => f.reporter.send()),
    });
    expect(await reporter.send()).toMatchObject({ state: 'closed', status: 'existing' });
  });

  it('does not undo a local quarantine when an older open report is accepted', async () => {
    const f = await reportingFixture(open);
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: async (request) => {
        const answer = await f.reporting.fetch(request);
        await f.options.connection.write(
          statement`UPDATE meter_capacity_state SET state = 'quarantined', revision = revision + 1`,
        );
        return answer;
      },
    });
    expect(await reporter.send()).toMatchObject({ state: 'open' });
    expect((await f.capacity.snapshot())?.state).toBe('quarantined');
    await expect(reporter.prepare()).rejects.toThrow('offline_allocation_quarantined');
  });
}
