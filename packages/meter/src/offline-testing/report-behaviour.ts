import { statement } from '@on.auto/ledger';
import { allocationPayload, offlineCheckpoint } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import type { MeterDatabase } from '../testing/database.ts';
import { assertOfflineConservation, dispatchRequest, reserveRequest } from './fixture.ts';
import { reportingFixture } from './report-fixture.ts';

export function reportBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('durable report snapshots', () => {
    snapshotBehaviour(open);
  });
  describe('acknowledged closure', () => {
    closureBehaviour(open);
  });
  describe('frozen admission', () => {
    closeIntentBehaviour(open);
  });
}

function snapshotBehaviour(open: () => Promise<MeterDatabase>): void {
  it('keeps a signed pending snapshot byte-for-byte while later local accounting proceeds', async () => {
    const f = await reportingFixture(open);
    const request = await reserveRequest('root', 3n);
    const hold = await f.meter.reserve(request);
    const prepared = await f.reporter.prepare();
    expect(prepared?.report).toMatchObject({
      sequence: 1,
      previousCheckpoint: await offlineCheckpoint(allocationPayload(f.allocation)),
      close: false,
      charges: [],
      counters: [
        { lotId: 'free-1', reservedUnits: 1_000_000n, committedUnits: 0n },
        { lotId: 'welcome-1', reservedUnits: 2_000_000n, committedUnits: 0n },
      ],
    });
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    const replica = await f.reportReplica();
    expect(await replica.pending()).toEqual(prepared);
    expect(await replica.prepare()).toEqual(prepared);
    expect(await replica.send()).toMatchObject({ state: 'open', sequence: 1, status: 'acknowledged' });
    expect(await f.reporter.pending()).toBeUndefined();
    const next = await f.reporter.prepare();
    expect(next?.report).toMatchObject({
      sequence: 2,
      previousCheckpoint: prepared?.checkpoint,
      charges: [{ playbookId: request.context.run.playbookId, runId: 'root', admittedAt: 5000, committedAt: 5000 }],
    });
    expect(next?.report.counters).toEqual([
      { lotId: 'free-1', reservedUnits: 1_000_000n, committedUnits: 0n },
      { lotId: 'welcome-1', reservedUnits: 1_000_000n, committedUnits: 1_000_000n },
    ]);
    await f.reporter.send();
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_report_receipts`)).toHaveLength(2);
    await assertOfflineConservation(f.options.connection);
  });

  it('gives twenty replicas one durable report and immutable original checkpoint', async () => {
    const f = await reportingFixture(open);
    const replica = await f.reportReplica();
    const prepared = await Promise.all(
      Array.from({ length: 10 }, () => [f.reporter.prepare(), replica.prepare()]).flat(),
    );
    expect(new Set(prepared.map((report) => report?.signedReport)).size).toBe(1);
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_local_reports`)).toHaveLength(1);
    expect(await f.options.connection.read(statement`SELECT sequence FROM meter_pending_report`)).toHaveLength(1);
  });
}

function closureBehaviour(open: () => Promise<MeterDatabase>): void {
  it('returns no local capacity until the authority acknowledges final settlement and enables one new epoch', async () => {
    const f = await reportingFixture(open);
    const request = await reserveRequest('root', 3n);
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await f.reporter.send();
    f.time.pass(6000);
    await f.meter.commitDispatch(dispatchRequest(hold, request, 'child'));
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    expect(await f.reporter.requestClose(f.allocation.id)).toMatchObject({ state: 'closing' });
    const final = await f.reporter.prepare();
    expect(final?.report).toMatchObject({
      sequence: 2,
      close: true,
      charges: [{ runId: 'child', admittedAt: 5000, committedAt: 11_000 }],
    });
    expect((await f.capacity.snapshot())?.state).toBe('closing');
    const next = {
      ...f.allocation,
      id: 'next',
      epoch: 2,
      sources: [{ lotId: 'purchased', source: 'topup', issuedAt: 1000, expiresAt: 30_000, units: 1_000_000n }],
    } satisfies Parameters<typeof f.authorize>[0];
    const nextToken = await f.authorize(next);
    await expect(f.capacity.install(nextToken)).rejects.toThrow('offline_allocation_unresolved');
    expect(await f.reporter.send()).toMatchObject({ state: 'closed', sequence: 2 });
    expect((await f.capacity.snapshot())?.state).toBe('closed');
    expect(await f.reporter.prepare()).toBeUndefined();
    expect(await f.reporter.send()).toBeUndefined();
    expect(await f.capacity.install(nextToken)).toMatchObject({ id: 'next', status: 'installed' });
    expect(await f.reporter.requestClose(f.allocation.id)).toMatchObject({ id: f.allocation.id, state: 'closed' });
    expect((await f.capacity.snapshot())?.state).toBe('open');
    await assertOfflineConservation(f.options.connection);
  });
}

function closeIntentBehaviour(open: () => Promise<MeterDatabase>): void {
  it('freezes admission while existing reservations drain, including zero-unused completion', async () => {
    const f = await reportingFixture(open);
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    const replica = await f.reportReplica();
    const closes = await Promise.all(
      Array.from({ length: 10 }, () => [
        f.reporter.requestClose(f.allocation.id),
        replica.requestClose(f.allocation.id),
      ]).flat(),
    );
    expect(closes.every((receipt) => receipt.state === 'closing')).toBe(true);
    expect(await f.options.connection.read(statement`SELECT allocation_id FROM meter_close_requests`)).toHaveLength(1);
    await expect(f.meter.reserve(await reserveRequest('another'))).rejects.toThrow('offline_allocation_unavailable');
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    expect((await f.reporter.prepare())?.report.close).toBe(false);
    await f.reporter.send();
    expect((await f.capacity.snapshot())?.state).toBe('closing');
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    expect((await f.reporter.prepare())?.report).toMatchObject({ close: true, charges: [] });
    expect(await f.reporter.send()).toMatchObject({ state: 'closed' });
    await assertOfflineConservation(f.options.connection);
  });

  it('reports and closes known usage after source expiry, revocation and loss of clock trust', async () => {
    const f = await reportingFixture(open);
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    await f.licenses.refuse((await f.licenses.head()).revision);
    f.time.state.wall -= 10_000;
    await f.clock.read();
    await f.reporter.requestClose(f.allocation.id);
    expect(await f.reporter.send()).toMatchObject({ state: 'closed' });
    expect(f.received).toHaveLength(1);
    expect(f.received[0]?.counters.reduce((sum, counter) => sum + counter.committedUnits, 0n)).toBe(1_000_000n);
  });
}
