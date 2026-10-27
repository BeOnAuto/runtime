import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { clockFixture } from '../testing/clock-fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { openLicenseClock } from './license-clock.ts';

function beforeReceipt(connection: ConnectionPorts, action: () => void): ConnectionPorts {
  return {
    ...connection,
    read: (sql) => {
      if (sql.strings.join('').includes('SELECT trusted_at')) action();
      return connection.read(sql);
    },
  };
}

describe('elapsed time while a trusted observation is persisted', () => {
  it('includes delay before the database anchor and after commit even when the wall clock is frozen', async () => {
    const f = await clockFixture(sqliteDatabase);
    const state = { delay: 10_000 };
    const clock = await openLicenseClock(
      {
        ...beforeReceipt(f.connection, () => {
          f.time.state.monotonic += state.delay;
        }),
        transaction: async (sql: Parameters<ConnectionPorts['transaction']>[0]) => {
          const rows = await f.connection.transaction(sql);
          f.time.state.monotonic += 20_000;
          return rows;
        },
      },
      f.time.samples,
    );
    expect(await clock.synchronize({ id: 'time-1', serverTime: 200_000 })).toEqual({
      now: 230_000,
      onlineRequired: false,
    });
    f.time.state.monotonic += 1000;
    expect((await clock.read()).now).toBe(231_000);
    expect(await f.connection.read(statement`SELECT trusted_at FROM meter_clock_refreshes`)).toEqual([
      { trusted_at: 200_000 },
    ]);
    state.delay = 0;
    f.time.state.monotonic += 1000;
    expect((await clock.synchronize({ id: 'time-1', serverTime: 200_000 })).now).toBe(232_000);
  });
});

describe('a broken clock during synchronization', () => {
  it('keeps elapsed time when a committed clock update loses its acknowledgement', async () => {
    const f = await clockFixture(sqliteDatabase);
    const clock = await openLicenseClock(
      {
        ...f.connection,
        transaction: async (sql: Parameters<ConnectionPorts['transaction']>[0]) => {
          await f.connection.transaction(sql);
          f.time.state.monotonic += 20_000;
          throw new Error('acknowledgement_lost');
        },
      },
      f.time.samples,
    );
    expect((await clock.synchronize({ id: 'time-1', serverTime: 200_000 })).now).toBe(220_000);
    f.time.state.monotonic += 5000;
    expect((await clock.synchronize({ id: 'time-1', serverTime: 200_000 })).now).toBe(225_000);
  });

  it('refuses a monotonic regression during synchronization without granting clock trust', async () => {
    const f = await clockFixture(sqliteDatabase);
    const clock = await openLicenseClock(
      beforeReceipt(f.connection, () => {
        f.time.state.monotonic = 0;
      }),
      f.time.samples,
    );
    f.time.state.monotonic = 1000;
    await expect(clock.synchronize({ id: 'time-1', serverTime: 200_000 })).rejects.toThrow('license_clock_invalid');
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes`)).toEqual([]);
    expect((await f.clock.read()).onlineRequired).toBe(true);
  });
});

describe('server time and network delay', () => {
  it('accepts a fresh faster response after a slower observation without rebasing an old receipt', async () => {
    const f = await clockFixture(sqliteDatabase);
    expect((await f.clock.synchronize({ id: 'slow', serverTime: 200_000, elapsedMilliseconds: 1000 })).now).toBe(
      201_000,
    );
    f.time.pass(100);
    expect((await f.clock.synchronize({ id: 'fast', serverTime: 200_100, elapsedMilliseconds: 10 })).now).toBe(200_110);
    expect((await f.clock.synchronize({ id: 'slow', serverTime: 200_000, elapsedMilliseconds: 1000 })).now).toBe(
      200_110,
    );
    f.time.pass(1000);
    expect((await f.clock.read()).now).toBe(201_110);
  });

  it.each([-1, 0.5, 30_001])('refuses an invalid observation interval %s', async (elapsedMilliseconds) => {
    const f = await clockFixture(sqliteDatabase);
    await expect(f.clock.synchronize({ id: 'time-1', serverTime: 200_000, elapsedMilliseconds })).rejects.toThrow(
      'license_clock_invalid',
    );
    expect((await f.clock.read()).onlineRequired).toBe(true);
  });
});
