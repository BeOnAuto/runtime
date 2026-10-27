import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { dispatchRequest, offlineFixture, reserveRequest } from '../offline-testing/fixture.ts';

describe('offline dispatch authority', () => {
  it('requires a known reservation, its scope and a reserved capability', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    const dispatch = dispatchRequest(hold, request);
    await expect(
      f.meter.commitDispatch({ ...dispatch, reservationId: `reservation:charge_${'0'.repeat(64)}` }),
    ).rejects.toThrow('offline_reservation_missing');
    await expect(f.meter.commitDispatch({ ...dispatch, run: { ...dispatch.run, accountId: 'other' } })).rejects.toThrow(
      'offline_reservation_scope_mismatch',
    );
    await expect(
      f.meter.commitDispatch({ ...dispatch, run: { ...dispatch.run, deploymentId: 'other' } }),
    ).rejects.toThrow('offline_reservation_scope_mismatch');
    await expect(f.meter.commitDispatch({ ...dispatch, capability: 'prediction' })).rejects.toThrow(
      'offline_capability_unreserved',
    );
    await expect(f.meter.commitDispatch({ ...dispatch, reservationId: 'bad' })).rejects.toThrow(
      'offline_reservation_id_invalid',
    );
    await expect(f.meter.commitDispatch({ ...dispatch, evidenceDigest: 'bad' })).rejects.toThrow(
      'offline_evidence_invalid',
    );
  });
});

describe('offline dispatch time', () => {
  it('requires the first dispatch before the earliest applicable deadline', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    f.time.pass(4000);
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow(
      'offline_dispatch_deadline_expired',
    );
    expect(
      await f.meter.release({
        reservationId: hold.reservationId,
        reason: 'not-dispatched',
        evidenceDigest: 'e'.repeat(64),
      }),
    ).toMatchObject({ units: 1_000_000n });
  });

  it('pauses further dispatch on clock loss but permits release without pretending work ran', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    f.time.state.wall -= 10_000;
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow('license_clock_untrusted');
    await f.meter.release({ reservationId: hold.reservationId, reason: 'cancelled', evidenceDigest: 'e'.repeat(64) });
    expect(await f.meter.reservation(hold.reservationId)).toMatchObject({ state: 'settled' });
  });
});

describe('offline settlement state', () => {
  it('refuses contradictory release evidence and changed retries', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.reserve(request);
    const release = { reservationId: hold.reservationId, evidenceDigest: 'e'.repeat(64) };
    await expect(f.meter.release({ ...release, reason: 'completed' })).rejects.toThrow(
      'offline_release_evidence_mismatch',
    );
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await expect(f.meter.release({ ...release, reason: 'not-dispatched' })).rejects.toThrow(
      'offline_release_evidence_mismatch',
    );
    await f.meter.release({ ...release, reason: 'completed' });
    await expect(f.meter.release({ ...release, reason: 'cancelled' })).rejects.toThrow('offline_command_conflict');
  });

  it('allows bounded work during closure, freezes dispatch in quarantine and preserves closed capacity', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest('root', 3n);
    const hold = await f.meter.reserve(request);
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'closing'`);
    await f.meter.commitDispatch(dispatchRequest(hold, request));
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'closed'`);
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request, 'closed'))).rejects.toThrow(
      'offline_allocation_unavailable',
    );
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'quarantined'`);
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request, 'quarantined'))).rejects.toThrow(
      'offline_allocation_unavailable',
    );
    expect(
      await f.meter.release({ reservationId: hold.reservationId, reason: 'cancelled', evidenceDigest: 'e'.repeat(64) }),
    ).toMatchObject({ units: 2_000_000n });
  });

  it('refuses new charge timestamps earlier than the durable admission after a bad fast-clock repair', async () => {
    const f = await offlineFixture();
    f.time.pass(2000);
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    await f.clock.synchronize({ id: 'fresh-correction', serverTime: 6000 });
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow(
      'offline_clock_precedes_reservation',
    );
  });
});
