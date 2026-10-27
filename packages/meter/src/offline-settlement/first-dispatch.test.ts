import type { LicenseEntitlement } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { dispatchRequest, offlineFixture, reserveRequest } from '../offline-testing/fixture.ts';

describe('first dispatch license authority', () => {
  it('requires the root before a child may consume its hold', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest('root', 2n);
    const hold = await f.meter.reserve(request);
    const dispatch = dispatchRequest(hold, request);
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request, 'child'))).rejects.toThrow(
      'offline_root_dispatch_required',
    );
    await expect(
      f.meter.commitDispatch({ ...dispatch, run: { ...dispatch.run, playbookId: 'other' } }),
    ).rejects.toThrow('offline_root_dispatch_required');
    await f.meter.commitDispatch(dispatch);
    expect(await f.meter.commitDispatch(dispatchRequest(hold, request, 'child'))).toMatchObject({ status: 'applied' });
  });

  it('refuses starting an old hold after online revocation', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    await f.licenses.refuse((await f.licenses.head()).revision);
    await expect(f.meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow('license_not_active');
    expect(
      await f.meter.release({
        reservationId: hold.reservationId,
        reason: 'not-dispatched',
        evidenceDigest: 'e'.repeat(64),
      }),
    ).toMatchObject({ units: 1_000_000n });
  });
});

describe('refreshed first dispatch policy', () => {
  it.each<Partial<LicenseEntitlement>>([{ capabilities: ['prediction'] }, { allocationIds: [] }, { grantIds: [] }])(
    'refuses starting a hold no longer authorized by refreshed policy %j',
    async (changes) => {
      const f = await offlineFixture();
      const request = await reserveRequest();
      const hold = await f.meter.reserve(request);
      const head = await f.licenses.head();
      const challenge = { ...(await f.challenge('refresh', 'updated-policy')), generation: head.generation };
      const bundle = await f.bundle(challenge, {
        allocationIds: [f.allocation.id],
        grantIds: f.allocation.sources.map((source) => source.lotId),
        ...changes,
      });
      const recorded = await f.licenses.record({
        expectedRevision: head.revision,
        challenge,
        ...bundle,
        allocationTokens: bundle.license.allocationIds.map(() => f.token),
        now: 5000,
      });
      expect(recorded.status).toBe('accepted');
      await expect(f.meter.commitDispatch(dispatchRequest(hold, request))).rejects.toThrow(
        'offline_reservation_no_longer_licensed',
      );
    },
  );
});
