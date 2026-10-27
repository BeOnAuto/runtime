import { describe, expect, it } from 'vitest';

import {
  openSelfHostedMeter,
  type OfflineReceipt,
  type OfflineReserveRequest,
  type SelfHostedMeter,
} from '../index.ts';
import { dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { selfHostedFixture } from '../self-hosted-testing/fixture.ts';

interface Dispatches {
  readonly meter: SelfHostedMeter;
  readonly hold: OfflineReceipt;
  readonly request: OfflineReserveRequest;
}

async function recordedDispatches(work: Dispatches, remaining: number): Promise<void> {
  if (remaining === 0) return;
  await work.meter.accounting.commitDispatch(dispatchRequest(work.hold, work.request, `child-${remaining}`));
  return recordedDispatches(work, remaining - 1);
}

describe('report backlog maintenance', () => {
  it('drains bounded charge batches promptly and stops after acknowledged final closure', async () => {
    const f = await selfHostedFixture();
    f.state.allocations = [
      {
        ...f.allocation,
        sources: [
          {
            lotId: 'purchased',
            source: 'topup',
            issuedAt: 5000,
            expiresAt: f.allocation.expiresAt,
            units: 130_000_000n,
          },
        ],
      },
    ];
    await f.meter.license.activate('activation-secret');
    const request = await reserveRequest('root', 130n);
    const hold = await f.meter.accounting.reserve(request);
    await f.meter.accounting.commitDispatch(dispatchRequest(hold, request));
    await recordedDispatches({ meter: f.meter, hold, request }, 129);
    await f.meter.accounting.release({
      reservationId: hold.reservationId,
      reason: 'completed',
      evidenceDigest: 'd'.repeat(64),
    });
    await f.meter.reporting.requestClose(f.allocation.id);
    expect((await f.meter.maintain()).reporting).toEqual({ status: 'reported', retryInMilliseconds: 1000 });
    f.pass(1000);
    expect((await f.meter.maintain()).reporting).toEqual({ status: 'reported', retryInMilliseconds: 300_000 });
    expect(f.received.map((report) => report.charges.length)).toEqual([128, 2]);
    expect((await f.meter.capacity())?.state).toBe('closed');
    f.pass(300_000);
    expect((await f.meter.maintain()).reporting.status).toBe('idle');
    expect(f.received).toHaveLength(2);
  });
});

describe('closure after a drained reservation', () => {
  it('schedules the final close promptly when the last reservation settles during report delivery', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    const request = await reserveRequest();
    const hold = await f.meter.accounting.reserve(request);
    await f.meter.accounting.commitDispatch(dispatchRequest(hold, request));
    await f.meter.reporting.requestClose(f.allocation.id);
    f.pass(1);
    const meter = await openSelfHostedMeter({
      ...f.options,
      fetch: async (message) => {
        const response = await f.options.fetch(message);
        await f.meter.accounting.release({
          reservationId: hold.reservationId,
          reason: 'completed',
          evidenceDigest: 'd'.repeat(64),
        });
        return response;
      },
    });
    expect((await meter.maintain()).reporting).toEqual({ status: 'reported', retryInMilliseconds: 1000 });
    f.pass(1000);
    expect((await meter.maintain()).reporting.status).toBe('reported');
    expect(f.received.map((report) => report.close)).toEqual([false, true]);
  });
});
