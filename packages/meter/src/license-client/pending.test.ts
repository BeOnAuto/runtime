import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { installationProofPayload } from '@on.auto/metering';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openLicenseClient } from '../index.ts';
import { readInstallationChallenge } from '../licensing/challenge.ts';
import { licenseClientFixture } from '../testing/license-client-fixture.ts';

function aroundPendingWrite(connection: ConnectionPorts, action: () => Promise<void>, before = false): ConnectionPorts {
  return {
    ...connection,
    write: async (sql) => {
      const pending = sql.strings.join('').includes('INSERT INTO meter_pending_license');
      if (pending && before) await action();
      const rows = await connection.write(sql);
      if (pending && !before) await action();
      return rows;
    },
  };
}

async function pendingChallenge(connection: ConnectionPorts) {
  const [row] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ challenge_payload: Schema.String })]))(
    await connection.read(statement`SELECT challenge_payload FROM meter_pending_license`),
  );
  const value: unknown = JSON.parse(row.challenge_payload);
  return readInstallationChallenge(value);
}

describe('pending-exchange persistence', () => {
  it('recovers a lost persistence acknowledgement before proving the stored challenge', async () => {
    const f = await licenseClientFixture();
    const client = await openLicenseClient({
      ...f.options,
      connection: aroundPendingWrite(f.options.connection, () => Promise.reject(new Error('acknowledgement_lost'))),
    });
    expect((await client.activate('activation-secret')).license.generation).toBe(1);
    expect(await client.resume()).toBeUndefined();
  });

  it('does not complete a challenge whose persistence failed', async () => {
    const f = await licenseClientFixture();
    const client = await openLicenseClient({
      ...f.options,
      connection: aroundPendingWrite(f.options.connection, () => Promise.reject(new Error('write_unavailable')), true),
    });
    await expect(client.activate('activation-secret')).rejects.toThrow('write_unavailable');
    expect(f.authority.requests.some((request) => request.url.endsWith('/complete'))).toBe(false);
    expect(await client.resume()).toBeUndefined();
  });

  it('refuses a pending slot that disappears before its acknowledgement is read', async () => {
    const f = await licenseClientFixture();
    const client = await openLicenseClient({
      ...f.options,
      connection: aroundPendingWrite(f.options.connection, async () => {
        await f.options.connection.write(statement`DELETE FROM meter_pending_license`);
      }),
    });
    await expect(client.activate('activation-secret')).rejects.toThrow('license_exchange_changed');
    expect((await client.head()).state).toBe('unlicensed');
  });
});

describe('damaged pending exchanges', () => {
  it.each([
    statement`UPDATE meter_pending_license SET challenge_id = 'changed'`,
    statement`UPDATE meter_pending_license SET challenge_payload = challenge_payload || ' '`,
  ])('refuses changed identities or noncanonical stored bytes', async (change) => {
    const f = await licenseClientFixture();
    f.authority.state.loseCompletion = true;
    await expect(f.client.activate('activation-secret')).rejects.toThrow('license_service_unavailable');
    await f.options.connection.write(change);
    await expect(f.client.resume()).rejects.toThrow('license_pending_invalid');
  });

  it('refuses a changed revision under the same challenge identity', async () => {
    const f = await licenseClientFixture();
    const client = await openLicenseClient({
      ...f.options,
      connection: aroundPendingWrite(f.options.connection, async () => {
        await f.options.connection.write(statement`UPDATE meter_pending_license SET expected_revision = 1`);
      }),
    });
    await expect(client.activate('activation-secret')).rejects.toThrow('license_pending_conflict');
  });

  it('refuses a changed challenge payload under the same identity and revision', async () => {
    const f = await licenseClientFixture();
    const client = await openLicenseClient({
      ...f.options,
      connection: aroundPendingWrite(f.options.connection, async () => {
        const original = await pendingChallenge(f.options.connection);
        const altered = installationProofPayload({ ...original, nonce: 'Q'.repeat(43) });
        await f.options.connection.write(statement`UPDATE meter_pending_license SET challenge_payload = ${altered}`);
      }),
    });
    await expect(client.activate('activation-secret')).rejects.toThrow('license_pending_conflict');
  });
});

describe('unusable or superseded server challenges', () => {
  it('clears a challenge no longer known by the service without disabling an existing valid lease', async () => {
    const f = await licenseClientFixture();
    const original = await f.client.activate('activation-secret');
    f.authority.state.completeStatus = 503;
    await expect(f.client.refresh()).rejects.toMatchObject({ status: 503 });
    const pending = await pendingChallenge(f.options.connection);
    const payload = installationProofPayload({ ...pending, id: 'missing-challenge' });
    await f.options.connection.write(
      statement`UPDATE meter_pending_license SET challenge_id = 'missing-challenge', challenge_payload = ${payload}`,
    );
    f.authority.state.completeStatus = 0;
    await expect(f.client.resume()).rejects.toMatchObject({ status: 404 });
    expect((await f.client.current()).license).toEqual(original.license);
    expect((await f.client.refresh()).license.generation).toBe(2);
  });

  it('does not confuse a new activation credential with an older pending exchange', async () => {
    const f = await licenseClientFixture();
    f.authority.state.completeStatus = 503;
    await expect(f.client.activate('activation-secret')).rejects.toMatchObject({ status: 503 });
    f.authority.state.licenseId = 'license-2';
    f.authority.state.activationKey = 'replacement-secret';
    f.authority.state.completeStatus = 0;
    await expect(f.client.activate('replacement-secret')).rejects.toThrow('license_exchange_in_progress');
    await expect(f.client.resume()).rejects.toMatchObject({ status: 401 });
    expect((await f.client.activate('replacement-secret')).license.licenseId).toBe('license-2');
  });
});
