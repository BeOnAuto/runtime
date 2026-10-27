import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { licenseProtocol, openLicenseClient, openLicenseState, type LicenseFetch } from '../index.ts';
import { licenseClientFixture } from '../testing/license-client-fixture.ts';

function afterCompletion(fetch: LicenseFetch, action: () => Promise<void>): LicenseFetch {
  return async (request) => {
    const response = await fetch(request);
    if (request.url.endsWith('/licenses/complete')) await action();
    return response;
  };
}

describe('late completion and clock failures', () => {
  it('cannot restore a license refused after the request began but before its response arrived', async () => {
    const f = await licenseClientFixture();
    const initial = await f.client.activate('activation-secret');
    const state = await openLicenseState({ ...f.options, installation: f.installation });
    const client = await openLicenseClient({
      ...f.options,
      fetch: afterCompletion(f.options.fetch, async () => {
        await state.refuse(initial.revision);
      }),
    });
    await expect(client.refresh()).rejects.toThrow('license_exchange_changed');
    expect((await client.head()).state).toBe('refused');
    expect(await client.resume()).toBeUndefined();
    expect((await f.client.refresh()).license.generation).toBe(3);
  });

  it('keeps a pending completion when clock trust is lost during the network exchange', async () => {
    const f = await licenseClientFixture();
    const client = await openLicenseClient({
      ...f.options,
      fetch: afterCompletion(f.options.fetch, () => {
        f.time.state.wall -= 10_000;
        return Promise.resolve();
      }),
    });
    await expect(client.activate('activation-secret')).rejects.toThrow('license_clock_untrusted');
    expect((await client.head()).state).toBe('unlicensed');
    expect(await f.database.connection.read(statement`SELECT challenge_id FROM meter_pending_license`)).toHaveLength(1);
    expect((await f.client.resume())?.license.generation).toBe(1);
  });
});

describe('central state changes while an exchange is pending', () => {
  it('discards a challenge superseded by another authenticated replica and requests current authority', async () => {
    const f = await licenseClientFixture();
    const original = await f.client.activate('activation-secret');
    f.authority.state.completeStatus = 503;
    await expect(f.client.refresh()).rejects.toMatchObject({ status: 503 });
    f.authority.state.completeStatus = 0;
    const other = licenseProtocol({
      ...f.options,
      installation: f.installation,
      monotonicTime: f.time.samples.monotonicTime,
    });
    const challenge = await other.refreshChallenge(crypto.randomUUID(), original.license.installationId);
    await other.complete(challenge, () => Promise.resolve(f.authority.state.now));
    await expect(f.client.resume()).rejects.toMatchObject({ status: 409 });
    expect((await f.client.current()).license).toEqual(original.license);
    expect((await f.client.refresh()).license.generation).toBe(3);
  });
});
