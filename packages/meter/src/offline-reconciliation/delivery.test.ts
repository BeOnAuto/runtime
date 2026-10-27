import { statement } from '@on.auto/ledger';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openOfflineReporter, type LicenseFetch } from '../index.ts';
import { dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { reportingFixture } from '../offline-testing/report-fixture.ts';
import { licenseFixture } from '../testing/license-fixture.ts';

const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

function changedReply(fetch: LicenseFetch, fields: Readonly<Record<string, unknown>>): LicenseFetch {
  return async (request) => Response.json({ ...record(await (await fetch(request)).json()), ...fields });
}

describe('bounded report delivery', () => {
  it('does nothing without capacity and refuses a close for an unknown allocation', async () => {
    const f = await licenseFixture();
    const reporter = await openOfflineReporter({
      connection: f.database.connection,
      installation: f.installation,
      authority: f.trust,
      fetch: () => Promise.reject(new Error('must_not_fetch')),
    });
    expect(await reporter.pending()).toBeUndefined();
    expect(await reporter.prepare()).toBeUndefined();
    expect(await reporter.send()).toBeUndefined();
    await expect(reporter.requestClose('missing')).rejects.toThrow('offline_allocation_not_current');
  });

  it('posts only the signed report to captured HTTPS authority without a cache or redirect', async () => {
    const f = await reportingFixture();
    const authority = { ...f.trust };
    const reporter = await openOfflineReporter({ ...f.reporting, authority });
    authority.issuer = 'https://changed.test';
    await reporter.send();
    expect(
      f.requests.map((request) => ({
        url: request.url,
        cache: request.cache,
        redirect: request.redirect,
        method: request.method,
      })),
    ).toEqual([
      { url: `${f.trust.issuer}/licenses/usage-reports`, cache: 'no-store', redirect: 'manual', method: 'POST' },
    ]);
    const [request] = f.requests;
    const body: unknown = await request?.json();
    expect(Object.keys(record(body)).toSorted()).toEqual(['allocationId', 'signedReport']);
  });
});

describe('unacknowledged reports', () => {
  it.each([400, 401, 403, 429, 503])(
    'retains the exact signed report after HTTP %s without returning escrow',
    async (status) => {
      const f = await reportingFixture();
      await f.reporter.requestClose(f.allocation.id);
      const prepared = await f.reporter.prepare();
      const reporter = await openOfflineReporter({
        ...f.reporting,
        fetch: () => Promise.resolve(new Response('private-server-details', { status })),
      });
      await expect(reporter.send()).rejects.toMatchObject({ message: 'license_service_refused', status });
      expect(await reporter.pending()).toEqual(prepared);
      expect((await f.capacity.snapshot())?.state).toBe('closing');
      expect(await f.options.connection.read(statement`SELECT sequence FROM meter_report_receipts`)).toEqual([]);
      expect(await f.reporter.send()).toMatchObject({ state: 'closed' });
    },
  );

  it('recovers the same report after an unknown network outcome', async () => {
    const f = await reportingFixture();
    const prepared = await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: async (request) => {
        await f.reporting.fetch(request);
        throw new Error('private-network-details');
      },
    });
    await expect(reporter.send()).rejects.toThrow('license_service_unavailable');
    expect(await reporter.pending()).toEqual(prepared);
    await f.reporter.send();
    expect(f.received).toHaveLength(2);
    expect(f.received[0]).toEqual(f.received[1]);
  });
});

describe('authenticated divergence quarantine', () => {
  it('preserves all source quantities and freezes new dispatch on an authority quarantine', async () => {
    const f = await reportingFixture();
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    const before = await f.capacity.snapshot();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: () =>
        Promise.resolve(
          Response.json({
            state: 'quarantined',
            allocationId: f.allocation.id,
            reason: 'source_counter_divergence',
          }),
        ),
    });
    expect(await reporter.send()).toMatchObject({ state: 'quarantined', sequence: 1 });
    expect((await f.capacity.snapshot())?.counters).toEqual(before?.counters);
    expect((await f.capacity.snapshot())?.checkpoint).toBe(before?.checkpoint);
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request, 'child'))).rejects.toThrow(
      'offline_allocation_unavailable',
    );
    await expect(reporter.prepare()).rejects.toThrow('offline_allocation_quarantined');
    await f.meter.release({ reservationId: hold.reservationId, reason: 'cancelled', evidenceDigest: 'd'.repeat(64) });
    expect((await f.capacity.snapshot())?.state).toBe('quarantined');
  });

  it('honors an authenticated already-quarantined refusal without reading its private body', async () => {
    const f = await reportingFixture();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      fetch: () => Promise.resolve(new Response('private-details', { status: 409 })),
    });
    expect(await reporter.send()).toMatchObject({ state: 'quarantined' });
    expect(await reporter.pending()).toBeUndefined();
    await expect(f.meter.reserve(await reserveRequest())).rejects.toThrow('offline_allocation_unavailable');
    expect(await f.options.connection.read(statement`SELECT response_json FROM meter_report_receipts`)).toEqual([
      {
        response_json: JSON.stringify({
          state: 'quarantined',
          allocationId: f.allocation.id,
          reason: 'allocation_quarantined',
        }),
      },
    ]);
  });
});

describe('exact acknowledgement binding', () => {
  it.each([
    { name: 'allocation', fields: { allocationId: 'other' } },
    { name: 'sequence', fields: { sequence: 2 } },
    { name: 'checkpoint', fields: { checkpoint: 'a'.repeat(64) } },
    { name: 'close state', fields: { state: 'closed' } },
    { name: 'committed quantity', fields: { committedUnits: '1' } },
    { name: 'returned quantity', fields: { returnedUnits: '1' } },
    { name: 'invalid quantity encoding', fields: { committedUnits: '01' } },
    { name: 'unbounded quarantine detail', fields: { state: 'quarantined', reason: 'private details!' } },
  ])(
    'refuses a mismatched $name and keeps the pending evidence',
    async ({ fields }: { readonly fields: Readonly<Record<string, unknown>> }) => {
      const f = await reportingFixture();
      const prepared = await f.reporter.prepare();
      const reporter = await openOfflineReporter({ ...f.reporting, fetch: changedReply(f.reporting.fetch, fields) });
      await expect(reporter.send()).rejects.toThrow(/response|canonical/iu);
      expect(await reporter.pending()).toEqual(prepared);
      expect((await f.capacity.snapshot())?.state).toBe('open');
    },
  );
});
