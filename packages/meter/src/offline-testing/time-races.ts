import type { ConnectionPorts } from '@on.auto/ledger';
import { expect, it } from 'vitest';

import { openOfflineMeter } from '../index.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { assertOfflineConservation, dispatchRequest, offlineFixture, reserveRequest } from './fixture.ts';

function onceBefore(connection: ConnectionPorts, action: () => Promise<unknown>) {
  const results: number[] = [];
  return {
    results,
    connection: {
      ...connection,
      transaction: async (sql: Parameters<ConnectionPorts['transaction']>[0]) => {
        if (results.length === 0) await action();
        const result = await connection.transaction(sql);
        results.push(result.length);
        return result;
      },
    },
  };
}

export function movingClockBehaviour(open: () => Promise<MeterDatabase>): void {
  it('admits and commits while other replicas advance trusted time within the approved deadline', async () => {
    const f = await offlineFixture(open);
    const meter = await openOfflineMeter({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          f.time.pass(1);
          await f.clock.read();
          return f.options.connection.transaction(sql);
        },
      },
    });
    const request = await reserveRequest();
    const held = await meter.reserve(request);
    expect(await meter.commitDispatch(dispatchRequest(held, request))).toMatchObject({
      status: 'applied',
      units: 1_000_000n,
    });
    await assertOfflineConservation(f.options.connection);
  });

  it('rechecks the license and allocation after a trusted-time refresh races admission', async () => {
    const f = await offlineFixture(open);
    const race = onceBefore(f.options.connection, () => f.clock.synchronize({ id: 'new-epoch', serverTime: 5001 }));
    const meter = await openOfflineMeter({ ...f.options, connection: race.connection });
    expect(await meter.reserve(await reserveRequest())).toMatchObject({ status: 'applied' });
    expect(race.results).toEqual([0, 1]);
  });
}

export function deadlineRaceBehaviour(open: () => Promise<MeterDatabase>): void {
  it('does not reserve after the approved deadline passes during its transaction', async () => {
    const f = await offlineFixture(open);
    const race = onceBefore(f.options.connection, async () => {
      f.time.pass(4000);
      await f.clock.read();
    });
    const meter = await openOfflineMeter({ ...f.options, connection: race.connection });
    await expect(meter.reserve(await reserveRequest())).rejects.toThrow('offline_quote_expired');
    expect(race.results).toEqual([0]);
    expect((await f.capacity.snapshot())?.counters).toMatchObject([
      { reservedUnits: 0n, committedUnits: 0n },
      { reservedUnits: 0n, committedUnits: 0n },
    ]);
  });

  it('does not dispatch after the original deadline passes during its transaction', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest();
    const held = await f.meter.reserve(request);
    const race = onceBefore(f.options.connection, async () => {
      f.time.pass(4000);
      await f.clock.read();
    });
    const meter = await openOfflineMeter({ ...f.options, connection: race.connection });
    await expect(meter.commitDispatch(dispatchRequest(held, request))).rejects.toThrow(
      'offline_dispatch_deadline_expired',
    );
    expect(race.results).toEqual([0]);
    expect(await meter.reservation(held.reservationId)).toMatchObject({ state: 'held' });
    await assertOfflineConservation(f.options.connection);
  });

  it('rechecks a first dispatch after a trusted-time refresh races it', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest();
    const held = await f.meter.reserve(request);
    const race = onceBefore(f.options.connection, () => f.clock.synchronize({ id: 'next-epoch', serverTime: 5001 }));
    const meter = await openOfflineMeter({ ...f.options, connection: race.connection });
    expect(await meter.commitDispatch(dispatchRequest(held, request))).toMatchObject({ status: 'applied' });
    expect(race.results).toEqual([0, 1]);
    await assertOfflineConservation(f.options.connection);
  });
}
