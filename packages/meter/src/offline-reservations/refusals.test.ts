import { statement } from '@on.auto/ledger';
import { runQuote, type WorkBound } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineMeter } from '../index.ts';
import { offlineFixture, reserveRequest } from '../offline-testing/fixture.ts';
import { capacityFixture } from '../testing/capacity-fixture.ts';

describe('offline reservation authority', () => {
  it('requires an installed allocation and refuses new work on frozen capacity', async () => {
    const f = await capacityFixture();
    const meter = await openOfflineMeter(f.options);
    const request = await reserveRequest();
    await expect(meter.reserve(request)).rejects.toThrow('offline_allocation_required');
    await f.capacity.install(f.token);
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'closing'`);
    await expect(meter.reserve(request)).rejects.toThrow('offline_allocation_unavailable');
    expect(await meter.reservation('missing')).toBeUndefined();
  });

  it('requires the licensed account, canonical installation identity and all requested capabilities', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    await expect(
      f.meter.reserve(
        await reserveRequest('other-account', 1n, { run: { ...request.context.run, accountId: 'other' } }),
      ),
    ).rejects.toThrow('offline_reservation_scope_mismatch');
    await expect(
      f.meter.reserve(
        await reserveRequest('other-deployment', 1n, { run: { ...request.context.run, deploymentId: 'other' } }),
      ),
    ).rejects.toThrow('offline_reservation_scope_mismatch');
    await expect(f.meter.reserve({ ...request, capabilities: ['recall'] })).rejects.toThrow(
      'offline_capability_unlicensed',
    );
  });
});

describe('offline admission time', () => {
  it('refuses expired quotes, expired allocations and untrusted clocks', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    f.time.pass(4000);
    await expect(f.meter.reserve(request)).rejects.toThrow('offline_quote_expired');
    f.time.state.wall -= 10_000;
    await expect(f.meter.reserve(request)).rejects.toThrow('license_clock_untrusted');
    await f.clock.synchronize({ id: 'repaired', serverTime: f.allocation.expiresAt + 1000 });
    await expect(f.meter.reserve(request)).rejects.toThrow('exp');
  });

  it('detects clock refusal occurring after license verification', async () => {
    const f = await offlineFixture();
    const meter = await openOfflineMeter({
      ...f.options,
      licenses: {
        ...f.licenses,
        current: async (time) => {
          const license = await f.licenses.current(time);
          f.time.state.wall -= 10_000;
          await f.clock.read();
          return license;
        },
      },
    });
    await expect(meter.reserve(await reserveRequest())).rejects.toThrow('license_clock_untrusted');
  });
});

describe('offline quote boundaries', () => {
  it('requires distinct capabilities and a positive platform envelope', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    await expect(f.meter.reserve({ ...request, capabilities: [] })).rejects.toThrow('offline_capabilities_invalid');
    await expect(f.meter.reserve({ ...request, capabilities: ['reasoning', 'reasoning'] })).rejects.toThrow(
      'offline_capabilities_invalid',
    );
    await expect(f.meter.reserve(await reserveRequest('empty', 0n))).rejects.toThrow('offline_reservation_empty');
  });

  it('rejects cloud resource and development spend against platform-only offline capacity', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    const development: WorkBound = { type: 'run', resources: [], developmentUnits: 1n };
    await expect(
      f.meter.reserve({ ...request, plan: development, quote: await runQuote(request.context, development, 5000) }),
    ).rejects.toThrow('offline_platform_capacity_only');
    const resources: WorkBound = {
      type: 'run',
      resources: [{ category: 'llm', payer: 'auto', baseUsd: '1', totalUsd: '1.2' }],
      developmentUnits: 0n,
    };
    await expect(
      f.meter.reserve({ ...request, plan: resources, quote: await runQuote(request.context, resources, 5000) }),
    ).rejects.toThrow('offline_platform_capacity_only');
  });

  it('rejects changed quote limits and captures caller-owned values before asynchronous work', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    await expect(
      f.meter.reserve({
        ...request,
        quote: { ...request.quote, maximum: { ...request.quote.maximum, platformUnits: 2_000_000n } },
      }),
    ).rejects.toThrow('approved quote');
    const capabilities = ['reasoning'] satisfies [...typeof request.capabilities];
    const context = { ...request.context, run: { ...request.context.run } };
    const promised = f.meter.reserve({ ...request, capabilities, context });
    context.run.accountId = 'changed-after-call';
    capabilities.length = 0;
    expect(await promised).toMatchObject({ status: 'applied' });
  });
});
