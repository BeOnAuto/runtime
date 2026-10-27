import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openSelfHostedMeter, type LicenseFetch, type SelfHostedMeter } from '../index.ts';
import { assertOfflineConservation, dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { selfHostedFixture } from '../self-hosted-testing/fixture.ts';

function reportOutage(fetch: LicenseFetch) {
  const state = { unavailable: true };
  return {
    state,
    fetch: (request: Readonly<Request>) =>
      state.unavailable ? Promise.resolve(new Response(null, { status: 503 })) : fetch(request),
  };
}

async function failedReports(meter: SelfHostedMeter, pass: (elapsed: number) => void, count: number): Promise<number> {
  const { reporting } = await meter.maintain();
  expect(reporting.status).toBe('failed');
  pass(reporting.retryInMilliseconds);
  return count === 1 ? reporting.retryInMilliseconds : failedReports(meter, pass, count - 1);
}

describe('composed maintenance cadence', () => {
  it('opens without a background timer and does no network work without a license or capacity', async () => {
    const f = await selfHostedFixture();
    expect(f.authority.requests).toHaveLength(0);
    expect(await f.meter.maintain()).toEqual({
      license: { status: 'idle', retryInMilliseconds: 60_000 },
      reporting: { status: 'idle', retryInMilliseconds: 300_000 },
      retryInMilliseconds: 60_000,
    });
    expect(f.authority.requests).toHaveLength(0);
    expect(f.received).toHaveLength(0);
  });

  it('coalesces report delivery across twenty concurrent local maintenance calls', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    const results = await Promise.all(Array.from({ length: 20 }, () => f.meter.maintain()));
    expect(results.every((result) => result.reporting.status === 'reported')).toBe(true);
    expect(f.received).toHaveLength(1);
    f.pass(1000);
    expect((await f.meter.maintain()).reporting).toEqual({ status: 'idle', retryInMilliseconds: 299_000 });
    f.pass(299_000);
    expect((await f.meter.maintain()).reporting.status).toBe('reported');
    expect(f.received).toHaveLength(2);
  });
});

describe('maintenance with refused licenses', () => {
  it('delivers known usage even when the concurrent license refresh confirms revocation', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    const request = await reserveRequest();
    const hold = await f.meter.accounting.reserve(request);
    await f.meter.accounting.commitDispatch(dispatchRequest(hold, request));
    f.pass(86_400_000);
    f.authority.state.completeStatus = 403;
    expect(await f.meter.maintain()).toMatchObject({
      license: { status: 'failed' },
      reporting: { status: 'reported' },
    });
    expect((await f.meter.license.head()).state).toBe('refused');
    expect(f.received[0]?.charges).toHaveLength(1);
    expect(await f.meter.reporting.pending()).toBeUndefined();
    await assertOfflineConservation(f.options.connection);
  });

  it('drains a pending report from quarantined state without unfreezing the allocation', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    await f.meter.reporting.prepare();
    await f.options.connection.write(
      statement`UPDATE meter_capacity_state SET state = 'quarantined', revision = revision + 1`,
    );
    f.pass(1);
    const meter = await openSelfHostedMeter({
      ...f.options,
      fetch: () => Promise.resolve(new Response(null, { status: 409 })),
    });
    expect((await meter.maintain()).reporting).toEqual({ status: 'quarantined', retryInMilliseconds: 3_600_000 });
    expect(await meter.reporting.pending()).toBeUndefined();
    expect((await meter.capacity())?.state).toBe('quarantined');
    f.pass(3_600_000);
    expect((await meter.maintain()).reporting).toEqual({ status: 'quarantined', retryInMilliseconds: 3_600_000 });
  });
});

describe('report delivery backoff', () => {
  it('retains one signed report, caps failures at an hour and resets its retry interval after recovery', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    f.pass(1);
    const outage = reportOutage(f.options.fetch);
    const meter = await openSelfHostedMeter({ ...f.options, fetch: outage.fetch });
    const prepared = await meter.reporting.prepare();
    expect(await failedReports(meter, f.pass, 9)).toBe(3_600_000);
    expect(await meter.reporting.pending()).toEqual(prepared);
    outage.state.unavailable = false;
    expect((await meter.maintain()).reporting.status).toBe('reported');
    expect(await meter.reporting.pending()).toBeUndefined();
    f.pass(300_000);
    outage.state.unavailable = true;
    expect((await meter.maintain()).reporting).toEqual({ status: 'failed', retryInMilliseconds: 30_000 });
  });
});
