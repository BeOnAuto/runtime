import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import type { MeterDatabase } from '../testing/database.ts';
import { assertOfflineConservation, dispatchRequest, offlineFixture, reserveRequest } from './fixture.ts';

export function settlementBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('bounded dispatch', () => {
    dispatchBehaviour(open);
    admittedBehaviour(open);
  });
  describe('attributed release', () => {
    releaseBehaviour(open);
    completionBehaviour(open);
  });
  describe('replica settlement', () => {
    racesBehaviour(open);
  });
}

function dispatchBehaviour(open: () => Promise<MeterDatabase>): void {
  it('commits each logical run once inside its parent hold and stops at the approved ceiling', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest('root', 3n);
    const hold = await f.meter.reserve(request);
    const dispatch = dispatchRequest(hold, request);
    expect(await f.meter.commitDispatch(dispatch)).toMatchObject({ status: 'applied', units: 1_000_000n });
    expect(await f.meter.commitDispatch(dispatch)).toMatchObject({ status: 'existing', units: 1_000_000n });
    await f.meter.commitDispatch(dispatchRequest(hold, request, 'child-1'));
    await f.meter.commitDispatch(dispatchRequest(hold, request, 'child-2'));
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request, 'too-many'))).rejects.toThrow(
      'offline_reservation_exhausted',
    );
    await expect(f.meter.commitDispatch({ ...dispatch, evidenceDigest: 'd'.repeat(64) })).rejects.toThrow(
      'offline_command_conflict',
    );
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(3);
    expect(await f.meter.reservation(hold.reservationId)).toMatchObject({
      state: 'running',
      parts: [
        { lotId: 'welcome-1', reservedUnits: 0n, committedUnits: 2_000_000n },
        { lotId: 'free-1', reservedUnits: 0n, committedUnits: 1_000_000n },
      ],
    });
    await assertOfflineConservation(f.options.connection);
  });

  it('splits one platform credit across fractional source capacity without rounding either source', async () => {
    const f = await offlineFixture(open, [
      { lotId: 'fraction', source: 'welcome', units: 250_000n, issuedAt: 1000, expiresAt: 10_000 },
      { lotId: 'rest', source: 'free', units: 1_750_000n, issuedAt: 1000, expiresAt: 20_000 },
    ]);
    const request = await reserveRequest('fractional', 2n);
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    expect(await f.meter.reservation(hold.reservationId)).toMatchObject({
      parts: [
        { lotId: 'fraction', committedUnits: 250_000n, reservedUnits: 0n },
        { lotId: 'rest', committedUnits: 750_000n, reservedUnits: 1_000_000n },
      ],
    });
    await assertOfflineConservation(f.options.connection);
  });
}

function admittedBehaviour(open: () => Promise<MeterDatabase>): void {
  it('finishes already-running bounded work after lease and source expiry without admitting another root', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    f.time.pass(f.allocation.expiresAt);
    await f.licenses.refuse((await f.licenses.head()).revision);
    expect(await f.meter.commitDispatch(dispatchRequest(hold, request, 'child'))).toMatchObject({ units: 1_000_000n });
    await expect(
      f.meter.reserve(await reserveRequest('late', 1n, { expiresAt: 2 * f.allocation.expiresAt })),
    ).rejects.toThrow('license_not_active');
    await assertOfflineConservation(f.options.connection);
  });
}

function releaseBehaviour(open: () => Promise<MeterDatabase>): void {
  it('releases only unused holds, preserves original expiry and makes cancellation final', async () => {
    const f = await offlineFixture(open);
    const request = await reserveRequest('root', 4n);
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    f.time.pass(6000);
    const release = {
      reservationId: hold.reservationId,
      reason: 'cancelled',
      evidenceDigest: 'd'.repeat(64),
    } satisfies Parameters<typeof f.meter.release>[0];
    expect(await f.meter.release(release)).toMatchObject({ status: 'applied', units: 3_000_000n });
    expect(await f.meter.release(release)).toMatchObject({ status: 'existing', units: 3_000_000n });
    expect(await f.meter.reservation(hold.reservationId)).toMatchObject({
      state: 'settled',
      parts: [
        { lotId: 'welcome-1', committedUnits: 1_000_000n, releasedUnits: 1_000_000n },
        { lotId: 'free-1', committedUnits: 0n, releasedUnits: 2_000_000n },
      ],
    });
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request, 'late-child'))).rejects.toThrow(
      'offline_reservation_settled',
    );
    await expect(
      f.meter.reserve(await reserveRequest('cannot-use-expired', 4n, { expiresAt: 30_000 })),
    ).rejects.toThrow('Insufficient');
    await f.meter.reserve(await reserveRequest('still-valid', 3n, { expiresAt: 30_000 }));
    await assertOfflineConservation(f.options.connection);
  });
}

function completionBehaviour(open: () => Promise<MeterDatabase>): void {
  it('records zero-charge validation failure and zero-unused successful completion', async () => {
    const f = await offlineFixture(open);
    const first = await reserveRequest('never-started');
    const held = await f.meter.reserve(first);
    await f.meter.release({
      reservationId: held.reservationId,
      reason: 'not-dispatched',
      evidenceDigest: 'e'.repeat(64),
    });
    const second = await reserveRequest('completed');
    const started = await f.meter.reserve(second);
    await f.meter.commitDispatch(dispatchRequest(started, second));
    expect(
      await f.meter.release({
        reservationId: started.reservationId,
        reason: 'completed',
        evidenceDigest: 'f'.repeat(64),
      }),
    ).toMatchObject({ units: 0n, status: 'applied' });
    expect(await f.meter.reservation(started.reservationId)).toMatchObject({ state: 'settled' });
    await assertOfflineConservation(f.options.connection);
  });
}

function racesBehaviour(open: () => Promise<MeterDatabase>): void {
  it('charges twenty replica dispatch retries once and cannot reuse that run in a different hold', async () => {
    const f = await offlineFixture(open);
    const replica = await f.replica();
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.reserve(request);
    const dispatch = dispatchRequest(hold, request);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => [f.meter.commitDispatch(dispatch), replica.commitDispatch(dispatch)]).flat(),
    );
    expect(results.filter((result) => result.status === 'applied')).toHaveLength(1);
    const other = await f.meter.reserve(await reserveRequest('another-root'));
    await expect(replica.commitDispatch({ ...dispatch, reservationId: other.reservationId })).rejects.toThrow(
      'offline_command_conflict',
    );
    await assertOfflineConservation(f.options.connection);
  });

  it('serializes a child dispatch and final cancellation without returning the same credit twice', async () => {
    const f = await offlineFixture(open);
    const replica = await f.replica();
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.reserve(request);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    const results = await Promise.allSettled([
      f.meter.commitDispatch(dispatchRequest(hold, request, 'child')),
      replica.release({ reservationId: hold.reservationId, reason: 'cancelled', evidenceDigest: 'd'.repeat(64) }),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    expect(await f.meter.reservation(hold.reservationId)).toMatchObject({ state: 'settled' });
    await assertOfflineConservation(f.options.connection);
  });
}
