import { statement } from '@on.auto/ledger';
import { allocationPayload } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineReporter } from '../index.ts';
import { dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { reportingFixture } from '../offline-testing/report-fixture.ts';
import { alteredReportRead, reportEvidence, reportFields } from '../offline-testing/report-projections.ts';

describe('acknowledgement history integrity', () => {
  it.each(['id', 'encoding'])('refuses changed allocation %s before saving a receipt', async (changed) => {
    const f = await reportingFixture();
    const prepared = await f.reporter.prepare();
    const claims: Readonly<Record<string, string>> = {
      id: allocationPayload({ ...f.allocation, id: 'different' }),
      encoding: `${allocationPayload(f.allocation)} `,
    };
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: alteredReportRead(
        f.options.connection,
        'SELECT claims_json FROM meter_capacity_history',
        reportFields({ claims_json: claims[changed] }),
      ),
    });
    await expect(reporter.send()).rejects.toThrow('offline_capacity_projection_invalid');
    expect(await f.reporter.pending()).toEqual(prepared);
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_report_receipts`)).toEqual([]);
  });

  it.each(['checkpoint', 'state', 'response'])('refuses a conflicting acknowledged %s', async (changed) => {
    const f = await reportingFixture();
    await f.reporter.prepare();
    const row = await reportEvidence(f.options.connection);
    const receipt = { checkpoint: row.checkpoint, state: 'open', response_json: 'altered' };
    const fields: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
      checkpoint: { checkpoint: 'b'.repeat(64) },
      state: { state: 'quarantined' },
      response: {},
    };
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: alteredReportRead(f.options.connection, 'FROM meter_report_receipts', () => [
        { ...receipt, ...fields[changed] },
      ]),
    });
    await expect(reporter.send()).rejects.toThrow('offline_report_acknowledgement_conflict');
    expect(await f.reporter.pending()).toBeDefined();
  });
});

describe('final report acceptance', () => {
  it.each(['open', 'closed', 'quarantined'])('cannot accept a final report over a changed %s state', async (state) => {
    const f = await reportingFixture();
    await f.reporter.requestClose(f.allocation.id);
    const prepared = await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: async (request) => {
        const answer = await f.reporting.fetch(request);
        await f.options.connection.write(
          statement`UPDATE meter_capacity_state SET state = ${state}, revision = revision + 1`,
        );
        return answer;
      },
    });
    await expect(reporter.send()).rejects.toThrow(/offline_allocation_unavailable|offline_report_close_unresolved/u);
    expect(await f.reporter.pending()).toEqual(prepared);
    expect((await f.capacity.snapshot())?.state).toBe(state);
  });

  it.each(['reserved_units', 'committed_units'])(
    'requires final %s to still match the frozen report',
    async (column) => {
      const f = await reportingFixture();
      await f.reporter.requestClose(f.allocation.id);
      const prepared = await f.reporter.prepare();
      const reporter = await openOfflineReporter({
        ...f.reporting,
        fetch: async (request) => {
          const answer = await f.reporting.fetch(request);
          const values = {
            reserved_units: Number(column === 'reserved_units'),
            committed_units: Number(column === 'committed_units'),
          };
          await f.options.connection.write(
            statement`UPDATE meter_capacity_usage SET reserved_units = ${values.reserved_units}, committed_units = ${values.committed_units} WHERE lot_id = 'welcome-1'`,
          );
          return answer;
        },
      });
      await expect(reporter.send()).rejects.toThrow('offline_report_close_unresolved');
      expect(await f.reporter.pending()).toEqual(prepared);
      expect((await f.capacity.snapshot())?.state).toBe('closing');
    },
  );
});

describe('unresolved final report evidence', () => {
  it('keeps a final report when a restored reservation still claims to be running', async () => {
    const f = await reportingFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    await f.reporter.requestClose(f.allocation.id);
    const prepared = await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: async (message) => {
        const answer = await f.reporting.fetch(message);
        await f.options.connection.write(statement`UPDATE meter_reservation_state SET state = 'running'`);
        return answer;
      },
    });
    await expect(reporter.send()).rejects.toThrow('offline_report_close_unresolved');
    expect(await f.reporter.pending()).toEqual(prepared);
  });

  it('retains a report when the allocation head disappears before acknowledgement', async () => {
    const f = await reportingFixture();
    await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: async (request) => {
        const answer = await f.reporting.fetch(request);
        await f.options.connection.write(statement`UPDATE meter_capacity_head SET current_id = NULL, last_epoch = 0`);
        return answer;
      },
    });
    await expect(reporter.send()).rejects.toThrow('offline_allocation_not_current');
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_pending_report`)).toHaveLength(1);
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_report_receipts`)).toEqual([]);
  });
});
