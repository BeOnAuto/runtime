import { MOST_REPORT_TOKEN_CHARACTERS } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import type { OfflineMeter, OfflineReceipt, OfflineReserveRequest } from '../index.ts';
import { dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { reportingFixture } from '../offline-testing/report-fixture.ts';
import { boundedReport } from './payload.ts';

interface Runs {
  readonly meter: OfflineMeter;
  readonly hold: OfflineReceipt;
  readonly request: OfflineReserveRequest;
}

async function chargeRuns(runs: Runs, count: number, index = 0): Promise<void> {
  if (index === count) return;
  const id = index === 0 ? runs.request.context.run.runId : String(index).padStart(256, 'r');
  await runs.meter.commitDispatch(dispatchRequest(runs.hold, runs.request, id));
  return chargeRuns(runs, count, index + 1);
}

describe('bounded offline report batches', () => {
  it('sends more than 128 charges in a monotonic chain before final close', async () => {
    const f = await reportingFixture(undefined, [
      { lotId: 'purchased', source: 'topup', issuedAt: 1000, expiresAt: 20_000, units: 130_000_000n },
    ]);
    const request = await reserveRequest('root', 130n);
    const hold = await f.meter.reserve(request);
    await chargeRuns({ meter: f.meter, hold, request }, 130);
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    await f.reporter.requestClose(f.allocation.id);
    const first = await f.reporter.prepare();
    expect(first?.report.charges).toHaveLength(128);
    expect(first?.report).toMatchObject({
      close: false,
      counters: [{ lotId: 'purchased', committedUnits: 128_000_000n, reservedUnits: 0n }],
    });
    await f.reporter.send();
    const final = await f.reporter.prepare();
    expect(final?.report).toMatchObject({
      sequence: 2,
      previousCheckpoint: first?.checkpoint,
      close: true,
      counters: [{ lotId: 'purchased', committedUnits: 130_000_000n, reservedUnits: 0n }],
    });
    expect(final?.report.charges).toHaveLength(2);
    expect(await f.reporter.send()).toMatchObject({ state: 'closed' });
    expect(f.received.flatMap((report) => report.charges)).toHaveLength(130);
  });
});

describe('offline report byte limits', () => {
  it('reduces a batch for long canonical identifiers and all 64 source counters', async () => {
    const f = await reportingFixture(
      undefined,
      Array.from({ length: 64 }, (_, index) => ({
        lotId: `lot-${index}`.padEnd(85, 's'),
        source: 'topup',
        issuedAt: 1000,
        expiresAt: 20_000,
        units: 2_000_000n,
      })),
    );
    const request = await reserveRequest('r'.repeat(256), 128n, {
      run: {
        accountId: 'account-1',
        deploymentId: 'installation-1',
        playbookId: 'p'.repeat(256),
        runId: 'r'.repeat(256),
      },
    });
    const hold = await f.meter.reserve(request);
    await chargeRuns({ meter: f.meter, hold, request }, 128);
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    await f.reporter.requestClose(f.allocation.id);
    const first = await f.reporter.prepare();
    expect(first?.report.charges.length).toBeLessThan(128);
    expect(first?.report.charges.length).toBeGreaterThan(0);
    expect(first?.signedReport.length).toBeGreaterThan(8192);
    expect(first?.signedReport.length).toBeLessThanOrEqual(MOST_REPORT_TOKEN_CHARACTERS);
    await f.reporter.send();
    const final = await f.reporter.prepare();
    expect(final?.report.close).toBe(true);
    await f.reporter.send();
    expect(f.received.flatMap((report) => report.charges)).toHaveLength(128);
    expect((await f.capacity.snapshot())?.state).toBe('closed');
  });
});

describe('oversized report metadata', () => {
  it('refuses unbounded metadata even when there are no charges left to remove', async () => {
    const f = await reportingFixture();
    expect(() => {
      boundedReport({
        capacity: {
          allocation: { ...f.allocation, issuer: `https://authority.test/${'a'.repeat(MOST_REPORT_TOKEN_CHARACTERS)}` },
          revision: 0,
          state: 'open',
          checkpoint: 'b'.repeat(64),
          counters: f.allocation.sources.map((source) => ({
            lotId: source.lotId,
            reservedUnits: 0n,
            committedUnits: 0n,
          })),
        },
        sequence: 0,
        reportedRevision: 0,
        previous: undefined,
        charges: [],
        activeReservations: false,
        observedTime: 5000,
      });
    }).toThrow('offline_report_exceeds_bound');
  });
});

describe('report time and conservative license time', () => {
  it('uses known observations and retains a report until the authority can accept every recorded timestamp', async () => {
    const f = await reportingFixture();
    f.authority.now = 5000;
    await f.clock.synchronize({ id: 'conservative-time', serverTime: 5000, elapsedMilliseconds: 30 });
    expect((await f.reporter.prepare())?.report.reportedAt).toBe(5000);
    await f.reporter.send();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
    await f.reporter.requestClose(f.allocation.id);
    const prepared = await f.reporter.prepare();
    expect(prepared?.report.reportedAt).toBe(5030);
    await expect(f.reporter.send()).rejects.toThrow('license_service_unavailable');
    expect(await f.reporter.pending()).toEqual(prepared);
    f.authority.now = 5030;
    expect(await f.reporter.send()).toMatchObject({ state: 'closed' });
  });
});
