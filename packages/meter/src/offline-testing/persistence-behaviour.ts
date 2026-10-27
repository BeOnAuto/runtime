import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openOfflineMeter, type OfflineMeter } from '../index.ts';
import type { OfflineAction } from '../offline-ledger/records.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { assertOfflineConservation, dispatchRequest, offlineFixture, reserveRequest } from './fixture.ts';

async function preparedAction(original: OfflineMeter, kind: OfflineAction) {
  const request = await reserveRequest('root', 2n);
  if (kind === 'reserve') return (meter: OfflineMeter) => meter.reserve(request);
  const hold = await original.reserve(request);
  if (kind === 'dispatch') return (meter: OfflineMeter) => meter.commitDispatch(dispatchRequest(hold, request));
  await original.commitDispatch(dispatchRequest(hold, request));
  return (meter: OfflineMeter) =>
    meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
}

export function offlinePersistenceBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('uncertain financial outcomes', () => {
    acknowledgementBehaviour(open);
  });
  describe('admission fences', () => {
    admissionRaces(open);
    firstDispatchRace(open);
  });
}

function firstDispatchRace(open: () => Promise<MeterDatabase>): void {
  it('fences a first dispatch when revocation races its last license check', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    const head = await f.licenses.head();
    const meter = await openOfflineMeter({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          await f.licenses.refuse(head.revision);
          return f.options.connection.transaction(sql);
        },
      },
    });
    await expect(meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow('license_not_active');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toEqual([]);
    await assertOfflineConservation(f.options.connection);
  });
}

function acknowledgementBehaviour(open: () => Promise<MeterDatabase>): void {
  it.each<OfflineAction>(['reserve', 'dispatch', 'release'])(
    'recovers the committed %s after a lost acknowledgement',
    async (kind) => {
      const f = await offlineFixture(open);
      const action = await preparedAction(f.meter, kind);
      const meter = await openOfflineMeter({
        ...f.options,
        connection: {
          ...f.options.connection,
          transaction: async (sql) => {
            await f.options.connection.transaction(sql);
            throw new Error('acknowledgement_lost');
          },
        },
      });
      expect(await action(meter)).toMatchObject({ status: 'existing', kind });
      expect(await action(f.meter)).toMatchObject({ status: 'existing', kind });
      await assertOfflineConservation(f.options.connection);
    },
  );

  it.each<OfflineAction>(['reserve', 'dispatch', 'release'])(
    'rolls back every %s effect after a late SQL failure',
    async (kind) => {
      const f = await offlineFixture(open);
      const action = await preparedAction(f.meter, kind);
      const before = await f.capacity.snapshot();
      const meter = await openOfflineMeter({
        ...f.options,
        connection: {
          ...f.options.connection,
          transaction: (sql) =>
            f.options.connection.transaction([...sql, statement`INSERT INTO missing_offline_table VALUES (1)`]),
        },
      });
      await expect(action(meter)).rejects.toThrow('missing_offline_table');
      expect(await f.capacity.snapshot()).toEqual(before);
      expect(await action(f.meter)).toMatchObject({ status: 'applied', kind });
      await assertOfflineConservation(f.options.connection);
    },
  );
}

function admissionRaces(open: () => Promise<MeterDatabase>): void {
  it('cannot hold new funds after a license refusal racing admission', async () => {
    const f = await offlineFixture(open);
    const head = await f.licenses.head();
    const meter = await openOfflineMeter({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          await f.licenses.refuse(head.revision);
          return f.options.connection.transaction(sql);
        },
      },
    });
    await expect(meter.reserve(await reserveRequest())).rejects.toThrow('license_not_active');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_local_commands`)).toEqual([]);
    await assertOfflineConservation(f.options.connection);
  });

  it('cannot hold new funds or dispatch when the shared clock becomes suspect before commit', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    const meter = await openOfflineMeter({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          f.time.state.wall -= 10_000;
          await f.clock.read();
          return f.options.connection.transaction(sql);
        },
      },
    });
    await expect(meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow('license_clock_untrusted');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toEqual([]);
    await assertOfflineConservation(f.options.connection);
  });
}
