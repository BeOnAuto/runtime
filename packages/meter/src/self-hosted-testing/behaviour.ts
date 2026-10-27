import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openSelfHostedMeter, type CurrentLicense } from '../index.ts';
import { assertOfflineConservation, dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { selfHostedFixture } from './fixture.ts';

export function selfHostedBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('one composed installation', () => {
    composedInstallation(open);
  });
  describe('automatic capacity delivery', () => {
    receivedCapacity(open);
  });
  describe('replica capacity recovery', () => {
    recoveredCapacity(open);
  });
  describe('reporting and a later epoch', () => {
    closedCapacity(open);
  });
}

function composedInstallation(open: () => Promise<MeterDatabase>): void {
  it('opens without network work and exposes only copied public installation metadata', async () => {
    const f = await selfHostedFixture(open);
    expect(await f.meter.license.head()).toMatchObject({ state: 'unlicensed' });
    expect(await f.meter.capacity()).toBeUndefined();
    expect(await f.meter.license.resume()).toBeUndefined();
    expect(await f.meter.license.poll()).toEqual({ status: 'idle', retryInMilliseconds: 60_000 });
    expect(f.authority.requests).toHaveLength(0);
    expect(Object.keys(f.meter.installation).toSorted()).toEqual(['clusterId', 'installationKeyDigest', 'publicKey']);
    Reflect.set(f.meter.installation, 'clusterId', 'altered');
    Reflect.set(f.meter.installation.publicKey, 'x', 'altered');
    await f.meter.license.activate('activation-secret');
    expect((await f.meter.capacity())?.allocation.clusterId).toBe(f.installation.clusterId);
  });

  it('shares the authenticated clock across activation, capacity and dispatch', async () => {
    const f = await selfHostedFixture(open);
    const current = await f.meter.license.activate('activation-secret');
    expect(current.license.allocationIds).toEqual([f.allocation.id]);
    expect((await f.meter.capacity())?.allocation).toEqual(f.allocation);
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.accounting.reserve(request);
    expect(await f.meter.accounting.commitDispatch(dispatchRequest(hold, request))).toMatchObject({
      units: 1_000_000n,
    });
    const before = await f.meter.capacity();
    expect((await f.meter.license.refresh()).license.generation).toBe(2);
    expect((await f.meter.capacity())?.counters).toEqual(before?.counters);
    await assertOfflineConservation(f.options.connection);
  });
}

function receivedCapacity(open: () => Promise<MeterDatabase>): void {
  it('grants no offline funds from an entitlement with no allocated sources', async () => {
    const f = await selfHostedFixture(open);
    f.state.allocations = [];
    await f.meter.license.activate('activation-secret');
    expect(await f.meter.capacity()).toBeUndefined();
    await expect(f.meter.accounting.reserve(await reserveRequest())).rejects.toThrow('offline_allocation_required');
    f.state.allocations = [f.allocation];
    await f.meter.license.refresh();
    expect((await f.meter.capacity())?.allocation).toEqual(f.allocation);
  });

  it('recovers a lost activation completion and installs its capacity after restart', async () => {
    const f = await selfHostedFixture(open);
    f.authority.state.loseCompletion = true;
    await expect(f.meter.license.activate('activation-secret')).rejects.toThrow('license_service_unavailable');
    expect(await f.meter.capacity()).toBeUndefined();
    f.pass(1);
    const next = await f.restart();
    expect((await next.license.resume())?.license.generation).toBe(1);
    expect((await next.capacity())?.allocation).toEqual(f.allocation);
    expect(await next.license.resume()).toBeUndefined();
    expect(await f.options.connection.read(statement`SELECT id FROM meter_capacity_history`)).toHaveLength(1);
  });
}

function capacityStorageUnavailable(connection: ConnectionPorts): ConnectionPorts {
  return {
    ...connection,
    transaction: (sql) => {
      if (sql.some((part) => part.strings.join('').includes('INSERT INTO meter_capacity_history')))
        return Promise.reject(new Error('capacity_storage_unavailable'));
      return connection.transaction(sql);
    },
  };
}

function recoveredCapacity(open: () => Promise<MeterDatabase>): void {
  it('repairs a crash between license persistence and capacity installation without another grant', async () => {
    const f = await selfHostedFixture(open);
    const meter = await openSelfHostedMeter({
      ...f.options,
      connection: capacityStorageUnavailable(f.options.connection),
    });
    await expect(meter.license.activate('activation-secret')).rejects.toThrow('capacity_storage_unavailable');
    expect((await meter.license.head()).state).toBe('active');
    expect(await meter.capacity()).toBeUndefined();
    expect((await meter.license.poll()).status).toBe('failed');
    f.pass(1);
    const next = await f.restart();
    expect((await next.license.poll()).status).toBe('idle');
    expect((await next.capacity())?.allocation).toEqual(f.allocation);
    expect(f.authority.requests.filter((request) => request.url.endsWith('/complete'))).toHaveLength(1);
  });

  it('installs one original capacity under competing activation and poll calls', async () => {
    const f = await selfHostedFixture(open);
    const next = await f.restart();
    const results: readonly Readonly<PromiseSettledResult<CurrentLicense>>[] = await Promise.allSettled([
      ...Array.from({ length: 10 }, () => [
        f.meter.license.activate('activation-secret'),
        next.license.activate('activation-secret'),
      ]).flat(),
      next.license.activate('wrong-secret'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThan(0);
    const refused = results.filter((result) => result.status === 'rejected');
    refused.forEach((result) => {
      expect(result.reason).toHaveProperty(
        'message',
        expect.stringMatching(/license_exchange_changed|license_service_refused/u),
      );
    });
    await Promise.all([f.meter.license.poll(), next.license.poll()]);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_capacity_history`)).toHaveLength(1);
    expect((await f.meter.capacity())?.counters).toEqual([
      { lotId: 'welcome-1', reservedUnits: 0n, committedUnits: 0n },
    ]);
  });
}

function closedCapacity(open: () => Promise<MeterDatabase>): void {
  it('delivers signed usage and acknowledges closure before installing a refreshed epoch', async () => {
    const f = await selfHostedFixture(open);
    await f.meter.license.activate('activation-secret');
    const request = await reserveRequest();
    const hold = await f.meter.accounting.reserve(request);
    await f.meter.accounting.commitDispatch(dispatchRequest(hold, request));
    expect((await f.meter.maintain()).reporting.status).toBe('reported');
    await f.meter.accounting.release({
      reservationId: hold.reservationId,
      reason: 'completed',
      evidenceDigest: 'd'.repeat(64),
    });
    await f.meter.reporting.requestClose(f.allocation.id);
    f.pass(300_000);
    expect((await f.meter.maintain()).reporting.status).toBe('reported');
    expect((await f.meter.capacity())?.state).toBe('closed');
    expect(f.received.map((report) => report.close)).toEqual([false, true]);
    f.state.allocations = [
      {
        ...f.allocation,
        id: 'allocation-2',
        epoch: 2,
        sources: [
          {
            lotId: 'purchase-2',
            source: 'topup',
            issuedAt: 5000,
            expiresAt: f.allocation.expiresAt,
            units: 3_000_000n,
          },
        ],
      },
    ];
    await f.meter.license.refresh();
    expect((await f.meter.capacity())?.allocation.epoch).toBe(2);
    expect((await f.meter.capacity())?.counters).toEqual([
      { lotId: 'purchase-2', reservedUnits: 0n, committedUnits: 0n },
    ]);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_capacity_history`)).toHaveLength(2);
    await assertOfflineConservation(f.options.connection);
  });
}
