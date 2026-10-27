import { statement } from '@on.auto/ledger';
import { MOST_ALLOCATION_TOKEN_CHARACTERS } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineCapacity } from '../index.ts';
import { capacityFixture } from '../testing/capacity-fixture.ts';

describe('offline installation authorization', () => {
  it.each(['', 'x'.repeat(MOST_ALLOCATION_TOKEN_CHARACTERS + 1)])(
    'bounds the token before database work',
    async (token) => {
      const f = await capacityFixture();
      await expect(f.capacity.install(token)).rejects.toThrow('offline_capacity_token_invalid');
      expect(await f.capacity.snapshot()).toBeUndefined();
    },
  );

  it('refuses modified signatures, foreign installations and expired capacity', async () => {
    const f = await capacityFixture();
    await expect(f.capacity.install(`${f.token}x`)).rejects.toThrow(/JWS|signature/u);
    const foreign = await f.allocationToken({ ...f.allocation, installationId: 'another-installation' });
    await expect(f.capacity.install(foreign)).rejects.toThrow('another authority');
    f.time.pass(f.allocation.expiresAt);
    await expect(f.capacity.install(f.token)).rejects.toThrow('exp');
    expect(await f.capacity.snapshot()).toBeUndefined();
  });

  it('observes a clock refusal that occurs after license verification', async () => {
    const f = await capacityFixture();
    const capacity = await openOfflineCapacity({
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
    await expect(capacity.install(f.token)).rejects.toThrow('license_clock_untrusted');
    expect(await f.capacity.snapshot()).toBeUndefined();
  });
});

describe('offline epoch and revision bounds', () => {
  it('refuses exhausted revisions without recording new capacity', async () => {
    const f = await capacityFixture();
    await f.options.connection.write(statement`UPDATE meter_capacity_head SET revision = 9007199254740991`);
    await expect(f.capacity.install(f.token)).rejects.toThrow('offline_capacity_exhausted');
    expect(await f.capacity.snapshot()).toBeUndefined();
  });

  it('refuses exhausted epochs after a previously closed allocation', async () => {
    const f = await capacityFixture();
    await f.capacity.install(f.token);
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'closed'`);
    await f.options.connection.write(statement`UPDATE meter_capacity_head SET last_epoch = 9007199254740991`);
    const token = await f.authorize({ ...f.allocation, id: 'allocation-2', epoch: 2 });
    await expect(f.capacity.install(token)).rejects.toThrow('offline_capacity_exhausted');
  });

  it('refuses persistent contention without an unbounded retry or a partial grant', async () => {
    const f = await capacityFixture();
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: { ...f.options.connection, transaction: () => Promise.resolve([]) },
    });
    await expect(capacity.install(f.token)).rejects.toThrow('offline_capacity_contended');
    expect(await f.capacity.snapshot()).toBeUndefined();
  });

  it('refuses SQLite replacement of the signed allocation and its source evidence', async () => {
    const f = await capacityFixture();
    await f.capacity.install(f.token);
    await expect(
      f.options.connection.write(
        statement`INSERT OR REPLACE INTO meter_capacity_history SELECT * FROM meter_capacity_history`,
      ),
    ).rejects.toThrow('Offline capacity evidence is immutable');
    await expect(
      f.options.connection.write(
        statement`INSERT OR REPLACE INTO meter_capacity_sources SELECT * FROM meter_capacity_sources`,
      ),
    ).rejects.toThrow('Offline capacity evidence is immutable');
  });
});
