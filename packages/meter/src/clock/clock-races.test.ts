import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { clockFixture } from '../testing/clock-fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { openLicenseClock } from './license-clock.ts';

function beforeSnapshot(connection: ConnectionPorts, action: () => Promise<void>) {
  const state = { armed: false };
  return {
    arm: () => {
      state.armed = true;
    },
    connection: {
      ...connection,
      read: async (sql: Parameters<ConnectionPorts['read']>[0]) => {
        if (state.armed && sql.strings.join('').includes('SELECT revision')) {
          state.armed = false;
          await action();
        }
        return connection.read(sql);
      },
    },
  };
}

describe('clock refresh races', () => {
  it('refuses SQLite replacement of a trusted refresh receipt', async () => {
    const f = await clockFixture(sqliteDatabase);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    await expect(
      f.connection.write(
        statement`INSERT OR REPLACE INTO meter_clock_refreshes (id, trusted_at) VALUES ('refresh-1', 0)`,
      ),
    ).rejects.toThrow('Clock refresh receipts are immutable');
    expect((await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).now).toBe(200_000);
  });
  it('recovers a duplicate accepted between receipt lookup and a snapshot containing a later refresh', async () => {
    const f = await clockFixture(sqliteDatabase);
    const racing = beforeSnapshot(f.connection, async () => {
      await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
      await f.clock.synchronize({ id: 'refresh-2', serverTime: 210_000 });
    });
    const clock = await openLicenseClock(racing.connection, f.time.samples);
    racing.arm();
    expect(await clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).toEqual({
      now: 210_000,
      onlineRequired: false,
    });
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes ORDER BY id`)).toEqual([
      { id: 'refresh-1' },
      { id: 'refresh-2' },
    ]);
  });

  it('refuses refresh when the trust epoch is exhausted and retains the last trusted anchor', async () => {
    const f = await clockFixture(sqliteDatabase);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    await f.connection.write(statement`UPDATE meter_clock SET trust_epoch = 9007199254740991`);
    await expect(f.clock.synchronize({ id: 'refresh-2', serverTime: 210_000 })).rejects.toThrow(
      'license_clock_contended',
    );
    expect((await f.clock.read()).now).toBe(200_000);
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes`)).toEqual([{ id: 'refresh-1' }]);
  });
});
