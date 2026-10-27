import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { clockBehaviour } from '../testing/clock-behaviour.ts';
import { clockFixture, testClock } from '../testing/clock-fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { openLicenseClock } from './license-clock.ts';

describe('the persisted license clock on SQLite', () => {
  clockBehaviour(sqliteDatabase);
});

describe('license clock recovery and refusal', () => {
  it('uses the database clock instead of a replica wall clock when the connection supplies one', async () => {
    const database = await sqliteDatabase();
    const time = testClock();
    const clock = await openLicenseClock(
      { ...database.connection, sharedClock: () => Promise.resolve(time.state.wall) },
      {
        ...time.samples,
        wallTime: () => {
          throw new Error('replica_wall_clock_used');
        },
      },
    );
    await clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    time.pass(10_000);
    expect(await clock.read()).toEqual({ now: 210_000, onlineRequired: false });
  });

  it('marks a regressed monotonic clock as suspect without letting it reduce elapsed time', async () => {
    const f = await clockFixture(sqliteDatabase);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    f.time.pass(10_000);
    await f.clock.read();
    f.time.state.monotonic = 1;
    expect(await f.clock.read()).toEqual({ now: 210_000, onlineRequired: true });
    f.time.state.monotonic = 0;
    expect((await f.clock.read()).onlineRequired).toBe(true);
  });

  it('accepts a fresh trusted correction after a fast wall clock while an old receipt cannot clear a later refusal', async () => {
    const f = await clockFixture(sqliteDatabase);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    f.time.state.wall += 1_000_000;
    expect((await f.clock.read()).now).toBe(1_200_000);
    expect(await f.clock.synchronize({ id: 'refresh-2', serverTime: 201_000 })).toEqual({
      now: 201_000,
      onlineRequired: false,
    });
    f.time.state.wall -= 10_000;
    expect((await f.clock.read()).onlineRequired).toBe(true);
    expect((await f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).onlineRequired).toBe(true);
  });
});

describe('invalid license clock input and unavailable persistence', () => {
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001])(
    'refuses the invalid wall sample %s',
    async (wall) => {
      const f = await clockFixture(sqliteDatabase);
      f.time.state.wall = wall;
      await expect(f.clock.read()).rejects.toThrow('license_clock_invalid');
    },
  );

  it('refuses unbounded derived time and negative monotonic time', async () => {
    const f = await clockFixture(sqliteDatabase);
    await f.clock.synchronize({ id: 'refresh-1', serverTime: 8_640_000_000_000_000 });
    f.time.state.monotonic = 1;
    await expect(f.clock.read()).rejects.toThrow('license_clock_invalid');
    f.time.state.monotonic = -1;
    await expect(f.clock.read()).rejects.toThrow('license_clock_invalid');
  });

  it('validates trusted receipt identity and exact time before changing the clock', async () => {
    const f = await clockFixture(sqliteDatabase);
    await Promise.all(
      ['', 'with space', 'a'.repeat(257)].map((id) =>
        expect(f.clock.synchronize({ id, serverTime: 1000 })).rejects.toThrow('license_clock_proof_invalid'),
      ),
    );
    await expect(f.clock.synchronize({ id: 'refresh-1', serverTime: 0.5 })).rejects.toThrow('license_clock_invalid');
    expect(await f.connection.read(statement`SELECT id FROM meter_clock_refreshes`)).toEqual([]);
  });
});

describe('unavailable clock persistence', () => {
  it('refuses bounded contention without granting clock trust or inventing a stored advance', async () => {
    const f = await clockFixture(sqliteDatabase);
    const refused = await openLicenseClock(
      { ...f.connection, write: () => Promise.resolve([]), transaction: () => Promise.resolve([]) },
      f.time.samples,
    );
    await expect(refused.read()).rejects.toThrow('license_clock_contended');
    await expect(refused.synchronize({ id: 'refresh-1', serverTime: 200_000 })).rejects.toThrow(
      'license_clock_contended',
    );
    expect((await f.clock.read()).onlineRequired).toBe(true);
  });

  it('refuses an exhausted database revision and a missing clock row', async () => {
    const f = await clockFixture(sqliteDatabase);
    await f.connection.write(statement`UPDATE meter_clock SET revision = 9007199254740991`);
    await expect(f.clock.read()).rejects.toThrow('license_clock_contended');
    await expect(f.clock.synchronize({ id: 'refresh-1', serverTime: 200_000 })).rejects.toThrow(
      'license_clock_contended',
    );
    await f.connection.write(statement`DELETE FROM meter_clock`);
    await expect(f.clock.read()).rejects.toThrow(/Missing|Expected/u);
  });
});
