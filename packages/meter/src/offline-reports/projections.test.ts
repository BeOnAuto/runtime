import { statement } from '@on.auto/ledger';
import { readUsageReportClaims, usageReportPayload } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineReporter } from '../index.ts';
import { dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { reportingFixture } from '../offline-testing/report-fixture.ts';
import { alteredReportRead, reportEvidence, reportFields } from '../offline-testing/report-projections.ts';

describe('stored report integrity', () => {
  it('refuses a pending sequence whose immutable report is missing', async () => {
    const f = await reportingFixture();
    await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: alteredReportRead(f.options.connection, 'FROM meter_local_reports', () => []),
    });
    await expect(reporter.pending()).rejects.toThrow('offline_report_history_unavailable');
    await expect(reporter.send()).rejects.toThrow('offline_report_history_unavailable');
    expect(f.requests).toHaveLength(0);
  });

  it.each<'sequence' | 'encoding' | 'payload' | 'checkpoint' | 'revision'>([
    'sequence',
    'encoding',
    'payload',
    'checkpoint',
    'revision',
  ])('refuses a changed report %s without replacing durable evidence', async (changed) => {
    const f = await reportingFixture();
    const prepared = await f.reporter.prepare();
    const row = await reportEvidence(f.options.connection);
    const report = readUsageReportClaims(JSON.parse(row.payload_json));
    const fields = {
      sequence: { payload_json: usageReportPayload({ ...report, sequence: report.sequence + 1 }) },
      encoding: { payload_json: `${row.payload_json} ` },
      payload: { payload_json: usageReportPayload({ ...report, counters: report.counters.toReversed() }) },
      checkpoint: { checkpoint: 'b'.repeat(64) },
      revision: { charge_revision: row.snapshot_revision + 1 },
    };
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: alteredReportRead(f.options.connection, 'FROM meter_local_reports', reportFields(fields[changed])),
    });
    await expect(reporter.send()).rejects.toThrow('offline_report_projection_invalid');
    expect(f.requests).toHaveLength(0);
    expect(await f.reporter.pending()).toEqual(prepared);
  });
});

describe('report chain projection integrity', () => {
  it('refuses a changed checkpoint before accepting a new report', async () => {
    const f = await reportingFixture();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET checkpoint = ${'b'.repeat(64)}`);
    await expect(f.reporter.prepare()).rejects.toThrow('offline_report_projection_invalid');
    expect(await f.reporter.pending()).toBeUndefined();
  });

  it('refuses an advanced charge cursor without acknowledged charge evidence', async () => {
    const f = await reportingFixture();
    await f.reporter.send();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET reported_revision = 1`);
    await expect(f.reporter.prepare()).rejects.toThrow('offline_report_projection_invalid');
    expect(await f.reporter.pending()).toBeUndefined();
  });

  it('cannot resume an allocation after an acknowledged final report', async () => {
    const f = await reportingFixture();
    await f.reporter.requestClose(f.allocation.id);
    await f.reporter.send();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'open'`);
    await expect(f.reporter.prepare()).rejects.toThrow('offline_report_projection_invalid');
    expect(await f.reporter.pending()).toBeUndefined();
  });
});

describe('report counter conservation', () => {
  it.each([0, 1_000_001])('refuses an altered source projection of %s committed units', async (committed) => {
    const f = await reportingFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await f.options.connection.write(
      statement`UPDATE meter_capacity_usage SET committed_units = ${committed} WHERE lot_id = 'welcome-1'`,
    );
    await expect(f.reporter.prepare()).rejects.toThrow('offline_report_counter_divergence');
    expect(await f.reporter.pending()).toBeUndefined();
  });
});
