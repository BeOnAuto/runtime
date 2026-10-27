import { statement } from '@on.auto/ledger';
import { runQuote } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import type { MeterDatabase } from '../testing/database.ts';
import { assertOfflineConservation, offlineFixture, reserveRequest } from './fixture.ts';

export function reservationBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('original source funding', () => {
    fundingBehaviour(open);
    competingBehaviour(open);
  });
  describe('shared reservation identity', () => {
    retryBehaviour(open);
  });
}

function fundingBehaviour(open: () => Promise<MeterDatabase>): void {
  it('holds the complete approved envelope from earliest-expiring sources and survives restart', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest('root-1', 4n);
    const receipt = await f.meter.reserve(request);
    expect(receipt).toMatchObject({ status: 'applied', kind: 'reserve', units: 4_000_000n, revision: 1 });
    const replica = await f.replica();
    expect(await replica.reservation(receipt.reservationId)).toMatchObject({
      context: request.context,
      quoteId: request.quote.id,
      capabilities: ['reasoning'],
      maximumUnits: 4_000_000n,
      admittedAt: 5000,
      dispatchBefore: 9000,
      state: 'held',
      parts: [
        { lotId: 'welcome-1', reservedUnits: 2_000_000n, committedUnits: 0n, releasedUnits: 0n },
        { lotId: 'free-1', reservedUnits: 2_000_000n, committedUnits: 0n, releasedUnits: 0n },
      ],
    });
    await expect(f.meter.reserve(await reserveRequest('another', 2n))).rejects.toThrow('Insufficient');
    await assertOfflineConservation(f.options.connection);
  });

  it('honors original source expiry and does not mint another monthly allowance', async () => {
    const f = await offlineFixture(open);
    f.time.pass(6000);
    const request = await reserveRequest('later', 3n, { expiresAt: 25_000 });
    const receipt = await f.meter.reserve(request);
    expect(await f.meter.reservation(receipt.reservationId)).toMatchObject({
      dispatchBefore: 20_000,
      parts: [{ lotId: 'free-1', reservedUnits: 3_000_000n }],
    });
    await expect(f.meter.reserve(await reserveRequest('exhausted', 1n, { expiresAt: 25_000 }))).rejects.toThrow(
      'Insufficient',
    );
    await assertOfflineConservation(f.options.connection);
  });
}

function competingBehaviour(open: () => Promise<MeterDatabase>): void {
  it('limits twenty competing replica reservations to the five credits actually escrowed', async () => {
    const f = await offlineFixture(open);
    const replica = await f.replica();
    const requests = await Promise.all(Array.from({ length: 20 }, (_, index) => reserveRequest(`run-${index}`)));
    const results = await Promise.allSettled([
      ...requests.slice(0, 10).map((request) => f.meter.reserve(request)),
      ...requests.slice(10).map((request) => replica.reserve(request)),
    ]);
    expect(results.filter((result: { readonly status: string }) => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((result: { readonly status: string }) => result.status === 'rejected')).toHaveLength(15);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_local_commands`)).toHaveLength(5);
    await assertOfflineConservation(f.options.connection);
  });
}

function retryBehaviour(open: () => Promise<MeterDatabase>): void {
  it('recovers one hold for twenty identical requests without rebasing its identity', async () => {
    const f = await offlineFixture(open);
    const replica = await f.replica();
    const request = await reserveRequest();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => [f.meter.reserve(request), replica.reserve(request)]).flat(),
    );
    expect(results.filter((result: { readonly status: string }) => result.status === 'applied')).toHaveLength(1);
    expect(new Set(results.map((result) => result.reservationId)).size).toBe(1);
    f.time.pass(20_000);
    expect(await replica.reserve(request)).toMatchObject({ status: 'existing', units: 1_000_000n });
    const context = { ...request.context, expiresAt: 40_000 };
    await expect(
      replica.reserve({ ...request, context, quote: await runQuote(context, request.plan, 25_000) }),
    ).rejects.toThrow('offline_command_conflict');
    await assertOfflineConservation(f.options.connection);
  });

  it('rejects changed capabilities and quotes on a reused logical run', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest();
    await f.meter.reserve(request);
    await expect(f.meter.reserve({ ...request, capabilities: ['prediction'] })).rejects.toThrow(
      'offline_command_conflict',
    );
    await expect(f.meter.reserve(await reserveRequest('run-1', 2n))).rejects.toThrow('offline_command_conflict');
    await assertOfflineConservation(f.options.connection);
  });
}
